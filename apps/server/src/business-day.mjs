/** Operational calendar in Brazil. Instants are always persisted as UTC ISO-8601.
 * Since 2019 Brazil/Sao_Paulo has UTC-03:00 year-round.
 * SQL projections keep this offset in sync with the JS business-day boundary.
 */
export const BUSINESS_TIME_ZONE='America/Sao_Paulo';
export const sqlBusinessDay=expression=>`date(${expression},'-3 hours')`;
export const sqlBusinessHour=expression=>`strftime('%H',${expression},'-3 hours')`;
const calendar=new Intl.DateTimeFormat('en-GB',{timeZone:BUSINESS_TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit'});
export function businessDay(value=new Date()){
  const date=value instanceof Date?value:new Date(value);
  if(!Number.isFinite(date.getTime()))throw new Error('Data/hora inválida');
  const parts=Object.fromEntries(calendar.formatToParts(date).map(({type,value})=>[type,value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
