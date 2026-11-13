let deletionBusy = false,
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

export const getDeletionBusy = () => deletionBusy;
export const getDeletionTable = () => deletionTable;
export const getDeletionProgress = () => deletionProgress;
export const getDeletionNotice = () => deletionNotice;
