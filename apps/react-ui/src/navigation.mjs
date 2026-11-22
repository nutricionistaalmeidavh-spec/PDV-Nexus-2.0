export const navigationLinks=[
 ['venda','▣','Nova venda','Operação'],['pedidos','≡','Pedidos','Operação'],['produtos','◇','Produtos e cardápio','Operação'],
 ['mesas','▦','Mesas e comandas','Restaurante'],['restaurante-config','⚙','Configuração da cozinha e pizzaria','Restaurante'],['delivery','▤','Delivery','Restaurante'],['kds','♨','Cozinha (KDS)','Restaurante'],['garcom','♙','Garçom mobile','Restaurante'],['atendimento','◎','Painel Central de Atendimento','Restaurante'],['divisao','⊞','Fechamento de mesa','Restaurante'],
 ['caixa','▤','Controle de caixa','Gestão'],['geral','▥','Gestão geral','Gestão'],['estoque','⬡','Estoque','Gestão'],
 ['financeiro','▥','Financeiro','Gestão'],['relatorios','▤','Relatórios','Gestão'],['inteligencia','◈','BI e previsões','Gestão'],['unidades','⇄','Unidades','Gestão'],['privacidade','◇','Privacidade delivery','Gestão'],['usuarios','♙','Usuários','Configuração'],
 ['integracoes','⇄','Integrações','Configuração'],['dispositivos','▦','Dispositivos LAN','Configuração'],
 ['impressao','▣','Impressão','Configuração'],['sistema','⚙','Backup e atualizações','Configuração'],['exportacao','⇩','Exportar vendas','Configuração'],['primeiro-acesso','⚙','Primeiro acesso','Configuração']
];

export const titleOf=id=>navigationLinks.find(x=>x[0]===id)?.[2]||'Nova venda';
const restricted=new Set(['produtos','caixa','geral','estoque','financeiro','relatorios','inteligencia','unidades','privacidade','delivery','usuarios','integracoes','dispositivos','impressao','sistema','exportacao','primeiro-acesso','restaurante-config']);
export function availableNavLinks(mode,pairedRole,user){
 if(mode==='paired')return navigationLinks.filter(([id])=>pairedRole==='kitchen'?id==='kds':['garcom','atendimento','divisao'].includes(id));
 const canEdit=!user||user.role==='admin';
 return navigationLinks.filter(([id])=>!restricted.has(id)||canEdit);
}
