export let deletionBusy = false,
  deletionTable = null,
  deletionProgress = '',
  deletionNotice = '';
export function setDeletionNotice(value) {
  return (deletionNotice = value);
}

export function setDeletionBusy(value) {
  return (deletionBusy = value);
}

export function setDeletionTable(value) {
  return (deletionTable = value);
}

export function setDeletionProgress(value) {
  return (deletionProgress = value);
}
