// Non-conforming on purpose: ways to reach Math.sin without writing Math.sin (ADR-0010).
export const viaBracket = (t: number): number => Math['sin'](t); // ✗
const { cos } = Math; // ✗
export const viaDestructure = (t: number): number => cos(t);
const m = Math; // ✗
export const viaAlias: unknown = m;
const key = 'tan';
export const viaDynamic: unknown = Math[key]; // ✗
export const viaCast = (Math as typeof Math).sin(1); // ✗
export const viaNonNull = Math!.sin(1); // ✗
export const viaSequence = (0, Math).sin(1); // ✗
export const viaReflect: unknown = Reflect.get(Math, 'sin'); // ✗
export const viaDefault = (M = Math): number => M.sin(1); // ✗
export const viaArray = [Math][0]?.sin(1); // ✗
export const viaObject = { Math }; // ✗
export const viaUnlisted: number = Math.fround(1) + Math.someFutureMember; // ✗
