/** Host-only sessions, salted scrypt credentials and explicit operator permissions. No SaaS. */
import { randomUUID, randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';

const memorySeconds=8*60*60,attemptWindowMs=60_000;
const digest=s=>createHash('sha256').update(s).digest('hex');
const stamp=()=>new Date().toISOString();
const validUsername=x=>typeof x==='string'&&/^[a-zA-Z0-9._-]{3,40}$/.test(x);
const validPassword=x=>typeof x==='string'&&x.length>=12&&x.length<=128;
const hashPassword=(password,salt)=>scryptSync(password,Buffer.from(salt,'hex'),64).toString('hex');

function userView(row) {return {id:row.id,username:row.username,role:row.role};}

export function createOperatorAuth(db) {
  const sessions=new Map(),failures=new Map();
  function configured(){return db.prepare('SELECT COUNT(*) AS amount FROM operator_account').get().amount>0;}
  function login(req,user) {
    const token=randomBytes(32).toString('base64url');
    const key=digest(token);
    sessions.set(key,{user:userView(user),expires:Date.now()+memorySeconds*1000});
    return {cookie:'nexus_sid='+token+'; Path=/; HttpOnly; SameSite=Strict; Max-Age='+memorySeconds,user:userView(user)};
  }
  function user(req) {
    const raw=req.headers.cookie??'';
    const match=raw.match(/(?:^|;\s*)nexus_sid=([A-Za-z0-9_-]{43})/);
    if(!match)return null;
    const key=digest(match[1]),entry=sessions.get(key);
    if(!entry)return null;
    if(entry.expires<=Date.now()){sessions.delete(key);return null;}
    const dbUser=db.prepare('SELECT id,username,role,enabled FROM operator_account WHERE id=?').get(entry.user.id);
    if(!dbUser||dbUser.enabled!==1){sessions.delete(key);return null;}
    return userView(dbUser);
  }
  function createOperator(username,password,role){
    if(!validUsername(username))throw new Error('Usuario invalido: 3 a 40 caracteres, letras, numeros, ponto e traco');
    if(!validPassword(password))throw new Error('Senha invalida: minimo de 12 e maximo de 128 caracteres');
    if(!['admin','cashier'].includes(role))throw new Error('Perfil invalido');
    const salt=randomBytes(16).toString('hex');
    const account={id:randomUUID(),username,role,password_salt:salt,password_hash:hashPassword(password,salt)};
    db.prepare('INSERT INTO operator_account(id,username,role,password_salt,password_hash,created_at) VALUES(?,?,?,?,?,?)')
      .run(account.id,username,role,salt,account.password_hash,stamp());
    return account;
  }
  function reply(res,status,body,cookie) {
    const headers={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
    if(cookie)headers['set-cookie']=cookie;
    res.writeHead(status,headers);res.end(JSON.stringify(body));
  }
  function handle(req,res,route,body) {
    if(req.method==='GET'&&route==='/api/auth/status'){
      return reply(res,200,{needsSetup:!configured(),authenticated:!!user(req),user:user(req)});
    }
    if(req.method==='POST'&&route==='/api/auth/setup'){
      if(configured())return reply(res,409,{code:'ALREADY_CONFIGURED',message:'Operador inicial ja configurado'});
      try {
        db.exec('BEGIN IMMEDIATE');
        if(configured()){db.exec('ROLLBACK');return reply(res,409,{code:'ALREADY_CONFIGURED'});}
        const account=createOperator(body?.username,body?.password,'admin');
        db.exec('COMMIT');
        const session=login(req,account);
        return reply(res,201,{user:session.user},session.cookie);
      } catch(e){if(db.isTransaction)db.exec('ROLLBACK');return reply(res,400,{code:'INVALID_OPERATOR',message:e.message});}
    }
    if(req.method==='POST'&&route==='/api/auth/login'){
      const username=body?.username,password=body?.password;
      if(!validUsername(username)||typeof password!=='string')return reply(res,401,{code:'INVALID_CREDENTIALS',message:'Credenciais invalidas'});
      const id=username.toLowerCase(),now=Date.now(),entry=failures.get(id);
      if(entry?.until>now)return reply(res,429,{code:'TOO_MANY_ATTEMPTS',message:'Aguarde antes de tentar novamente'});
      const account=db.prepare('SELECT * FROM operator_account WHERE username=? COLLATE NOCASE AND enabled=1').get(username);
      // Mesmo em usuario inexistente executar scrypt para reduzir enumeracao por timing.
      const actual=hashPassword(password,account?.password_salt??'0'.repeat(32));
      const compare=account?.password_hash??'0'.repeat(128);
      const valid=timingSafeEqual(Buffer.from(actual,'hex'),Buffer.from(compare,'hex'))&&!!account;
      if(!valid){
        const count=(entry?.count??0)+1;
        failures.set(id,{count,until:count>=5?now+attemptWindowMs:0});
        return reply(res,401,{code:'INVALID_CREDENTIALS',message:'Credenciais invalidas'});
      }
      failures.delete(id);
      const session=login(req,account);
      return reply(res,200,{user:session.user},session.cookie);
    }
    if(req.method==='POST'&&route==='/api/auth/logout'){
      const match=(req.headers.cookie??'').match(/(?:^|;\s*)nexus_sid=([A-Za-z0-9_-]{43})/);
      if(match)sessions.delete(digest(match[1]));
      return reply(res,200,{ok:true},'nexus_sid=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
    }
    if(req.method==='POST'&&route==='/api/auth/operators'){
      const operator=user(req);
      if(!operator)return reply(res,401,{code:'AUTH_REQUIRED',message:'Entre com a conta de operador'});
      if(operator.role!=='admin')return reply(res,403,{code:'FORBIDDEN',message:'Somente supervisor pode criar operadores'});
      try{
        db.exec('BEGIN IMMEDIATE');
        const account=createOperator(body?.username,body?.password,body?.role);
        db.prepare('INSERT INTO audit_log(id,aggregate_id,action,actor_id,payload_json,created_at) VALUES(?,?,?,?,?,?)')
          .run(randomUUID(),account.id,'OPERATOR_CREATED',operator.id,JSON.stringify({username:account.username,role:account.role}),stamp());
        db.exec('COMMIT');return reply(res,201,{user:userView(account)});
      }catch(e){if(db.isTransaction)db.exec('ROLLBACK');return reply(res,400,{code:'INVALID_OPERATOR',message:e.message});}
    }
    return reply(res,404,{code:'NOT_FOUND',message:'Rota de autenticacao inexistente'});
  }
  return {handle,user,configured};
}

export function allowedOperator(role,method,route){
  if(role==='admin')return true;
  if(role!=='cashier')return false;
  if(/^\/api\/auth\//.test(route))return false;
  if(/^\/api\/exports\//.test(route)||route==='/api/purchases'||/^\/api\/purchases\//.test(route))return false;
  if(/^\/api\/(bi|stock|reports|delivery|system|sync|suppliers)\//.test(route)||route==='/api/suppliers')return false;
  if(/^\/api\/printer/.test(route)||/^\/api\/print\/jobs\/[^/]+\/send$/.test(route))return false;
  if(/^\/api\/products/.test(route)&&method!=='GET')return false;
  if(/^\/api\/categories/.test(route)&&method!=='GET')return false;
  if(/^\/api\/tables/.test(route)&&method==='PATCH')return false;
  if(/^\/api\/orders\/[^/]+\/(refund|refund-items)$/.test(route))return false;
  if(/^\/api\/kitchen/.test(route)&&method==='POST')return false;
  if(/^\/api\/pairing/.test(route))return false;
  return true;
}
