import React from 'react';
function Button({children,kind='secondary',busy=false,...props}){return <button type="button" className={'btn '+kind} disabled={busy||props.disabled} {...props}>{children}</button>}
function Pill({children,tone='purple'}){return <span className={'pill '+tone}>{children}</span>}
function Frame({title,eyebrow,description,action,children}){return <div className="page"><div className="pageheading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1>{description&&<p className="subtext">{description}</p>}</div>{action&&<div className="heading-action">{action}</div>}</div>{children}</div>}
function Panel({children,className='',title,aside}){return <section className={'panel '+className}>{title&&<div className="sectiontitle"><h2>{title}</h2>{aside}</div>}{children}</section>}
function Empty({children}){return <div className="empty">{children}</div>}
function MoneyInput({label,value,onChange,placeholder='0,00',min,...rest}){return <label className="field">{label}<input inputMode="decimal" value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} {...rest}/></label>}
function Modal({title,children,onClose,footer,width='normal'}){return <div className="modal-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}><section className={'modal modal-'+width} role="dialog" aria-modal="true" aria-label={title}><header className="modal-head"><h2>{title}</h2><Button onClick={onClose} kind="icon" aria-label="Fechar">×</Button></header><div className="modal-content">{children}</div>{footer&&<footer className="modal-foot">{footer}</footer>}</section></div>}

export {Button,Pill,Frame,Panel,Empty,MoneyInput,Modal};
