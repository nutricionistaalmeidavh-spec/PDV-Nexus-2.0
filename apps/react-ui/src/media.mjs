const nameToAsset=[
 ['x-bacon','xbacon'],['x-burger','xburger'],['x-salada','xsalada'],
 ['batata','batata'],['nugget','nuggets'],['pão','pao'],['refrigerante','refrigerante'],
 ['água','agua'],['café','cafe'],['leite','leite'],['queijo','queijo']
];
/** Retorna apenas assets incluídos no repositório, nunca URL remota. */
export function foodAsset(product){
 if(!product) return null;
 const id=String(product.id||'').toLowerCase();
 const name=String(product.name||'').toLocaleLowerCase('pt-BR');
 const known=['xbacon','xburger','xsalada','batata','nuggets','pao','refrigerante','agua','cafe','leite','queijo'];
 const asset=known.includes(id)?id:nameToAsset.find(([term])=>name.includes(term))?.[1];
 return asset?`/assets/${asset}.png`:null;
}
