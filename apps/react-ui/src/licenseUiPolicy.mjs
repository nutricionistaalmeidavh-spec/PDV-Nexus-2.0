/** An expired commercial entitlement never authorizes new work.
 * Existing work remains accessible to an authenticated operator for settlement.
 */
export function canAccessExistingWork(license){
  if(!license?.required || license.active===true)return true;
  return license.active===false&&license.reason==='SUSPENDED';
}
export function canCreateNewWork(license){
  return !license?.required||license.active===true;
}
