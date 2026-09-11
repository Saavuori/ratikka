/**
 * The operator behind a journey, from the `oper` field on its HFP messages.
 *
 * HSL does not run the vehicles itself: it tenders each route out, so the tram
 * you are on belongs to one company and the bus behind it to another. The feed
 * names them only by number.
 *
 * Static reference data, so it lives here rather than being rebuilt inside a
 * component on every render.
 */
const OPERATOR_NAMES: Record<number, string> = {
  6: 'Oy Pohjolan Liikenne Ab',
  9: 'Pääkaupunkiseudun Kaupunkiliikenne Oy',
  12: 'Helsingin Bussiliikenne',
  18: 'Oy Pohjolan Liikenne Ab',
  22: 'Nobina Finland Oy',
  40: 'Tammelundin Liikenne',
  47: 'Åbergin Linja Oy',
  50: 'Pääkaupunkiseudun Kaupunkiliikenne Oy',
  90: 'VR-Yhtymä Oyj',
};

/**
 * The operator's name, or the number itself when it is one we do not have a
 * name for — better than claiming not to know who is running the vehicle.
 */
export function operatorName(id?: number): string {
  if (id === undefined) return 'HSL Operator';
  return OPERATOR_NAMES[id] ?? `Operator #${id}`;
}
