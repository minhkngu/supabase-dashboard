// Cấu hình cột được cập nhật tập trung, các module khác đọc qua state.
const config = { formulas: undefined, lookups: [], ready: false };
export const getFormulas = () => config.formulas;
export const getLookups = () => config.lookups;
export const getConfigReady = () => config.ready;
export function setFormulas(value) {
  config.formulas = value;
}
export function setLookups(value) {
  config.lookups = value;
}
export function setConfigReady(value) {
  config.ready = value;
}
export function addFormula(value) {
  config.formulas.push(value);
}
