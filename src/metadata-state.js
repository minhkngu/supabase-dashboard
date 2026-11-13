// Metadata được thay thế qua các thao tác của module này.
const metadata = { tables: [], table: null, enumTypes: [] };
export function getTables() {
  return metadata.tables;
}
export function getTable() {
  return metadata.table;
}
export function getEnumTypes() {
  return metadata.enumTypes;
}
export function setTables(tables) {
  metadata.tables = tables;
}
export function setTable(table) {
  metadata.table = table;
}
export function setEnumTypes(types) {
  metadata.enumTypes = types;
}
export function sortTables(compare) {
  metadata.tables.sort(compare);
}
export function removeTableAt(index) {
  return metadata.tables.splice(index, 1)[0];
}
export function insertTableAt(index, table) {
  metadata.tables.splice(index, 0, table);
}
