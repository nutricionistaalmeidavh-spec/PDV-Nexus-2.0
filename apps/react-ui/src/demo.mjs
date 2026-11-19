export const sampleCategories=[
 {id:'c-all',name:'Todos',color:'purple',icon:'▤'},
 {id:'c-lanches',name:'Lanches',color:'yellow',icon:'☰'},
 {id:'c-porcoes',name:'Porções',color:'pink',icon:'♨'},
 {id:'c-bebidas',name:'Bebidas',color:'blue',icon:'◫'},
 {id:'c-combos',name:'Combos',color:'green',icon:'▦'},
 {id:'c-doces',name:'Sobremesas',color:'orange',icon:'◇'}
];
export const sampleProducts=[
 {id:'xburger',name:'X-Burger',priceCents:2490,categoryId:'c-lanches',emoji:'🍔',active:1},
 {id:'xbacon',name:'X-Bacon',priceCents:2890,categoryId:'c-lanches',emoji:'🍔',active:1},
 {id:'xsalada',name:'X-Salada',priceCents:2690,categoryId:'c-lanches',emoji:'🥪',active:1},
 {id:'batata',name:'Batata Frita',priceCents:1400,categoryId:'c-porcoes',emoji:'🍟',active:1},
 {id:'refri',name:'Refrigerante',priceCents:600,categoryId:'c-bebidas',emoji:'🥤',active:1},
 {id:'suco',name:'Suco Natural',priceCents:950,categoryId:'c-bebidas',emoji:'🧃',active:1},
 {id:'nuggets',name:'Nuggets (6 un.)',priceCents:1600,categoryId:'c-porcoes',emoji:'🍗',active:1},
 {id:'milk',name:'Milk-shake',priceCents:1590,categoryId:'c-doces',emoji:'🥛',active:1}
];
export const sampleModifiers=[{id:'m-bacon',name:'Bacon',priceCents:500,active:1},{id:'m-queijo',name:'Queijo extra',priceCents:300,active:1},{id:'m-ovo',name:'Ovo',priceCents:200,active:1}];
export const sampleTables=Array.from({length:12},(_,i)=>({id:`mesa-${i+1}`,label:`Mesa ${String(i+1).padStart(2,'0')}`,orderId:[1,2,5,9].includes(i)?`demo-${i}`:null,orderStatus:[1,2,5,9].includes(i)?'OPEN':null}));
export const sampleTickets=[
 {id:'t-1',orderId:'demo-1085',status:'PENDING',revision:0,quantity:1,productName:'X-Burger',tableLabel:'Mesa 03',note:'Sem cebola'},
 {id:'t-2',orderId:'demo-1086',status:'PENDING',revision:0,quantity:1,productName:'Batata Frita',tableLabel:'Mesa 02'},
 {id:'t-3',orderId:'demo-1084',status:'PREPARING',revision:0,quantity:1,productName:'X-Bacon',tableLabel:'Balcão'},
 {id:'t-4',orderId:'demo-1082',status:'READY',revision:0,quantity:2,productName:'Refrigerante',tableLabel:'Mesa 05'}
];
export const sampleOrders=[
 {id:'demo-1085',status:'OPEN',serviceMode:'table',revision:2,createdAt:'2026-11-18T18:00:00Z'},
 {id:'demo-1084',status:'OPEN',serviceMode:'counter',revision:2,createdAt:'2026-11-18T18:03:00Z'},
 {id:'demo-1083',status:'CLOSED',serviceMode:'takeaway',revision:3,createdAt:'2026-11-18T17:49:00Z'}
];
