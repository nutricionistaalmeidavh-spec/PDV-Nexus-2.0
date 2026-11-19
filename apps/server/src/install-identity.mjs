/** Read-only installation identity for future opt-in multi-store sync. No external calls. */
export function installationRead(db,method,route){
  if(method!=='GET'||route!=='/api/system/identity')return null;
  const row=db.prepare("SELECT unit_id AS unitId,created_at AS createdAt FROM installation_identity WHERE id='local'").get();
  return {status:200,body:{...row,mode:'STANDALONE',syncEnabled:false,sharedDatabase:false,
    message:'Esta instalação possui banco de dados único. Sincronização entre lojas permanece desativada.'}};
}
