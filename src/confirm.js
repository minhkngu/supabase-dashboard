// In-page replacements for window.confirm/prompt/alert, styled like the
// other dialogs and usable with the keyboard.
import { $ } from './state.js';

let settle = null,
  promptValidate = null;

function open({ title, message = '', confirmLabel, danger = false, input = null, cancel = true }) {
  settle?.(null);
  const dialog = $('#confirmDialog');
  $('#confirmTitle').textContent = title;
  $('#confirmMessage').textContent = message;
  $('#confirmMessage').hidden = !message;
  $('#confirmError').textContent = '';
  $('#confirmOk').textContent = confirmLabel;
  $('#confirmOk').className = danger ? 'danger' : 'primary';
  $('#confirmInputWrap').hidden = !input;
  $('#confirmCancel').hidden = !cancel;
  if (input) {
    $('#confirmInputLabel').textContent = input.label;
    $('#confirmInput').value = input.value || '';
  }
  return new Promise(resolve => {
    settle = value => {
      settle = null;
      resolve(value);
    };
    dialog.showModal();
    if (input) {
      $('#confirmInput').focus();
      $('#confirmInput').select();
    } else (danger ? $('#confirmCancel') : $('#confirmOk')).focus();
  });
}

/** Resolves true when confirmed, false when cancelled. */
export async function confirmDialog({ title, message, confirmLabel = 'Xác nhận', danger = false }) {
  return (await open({ title, message, confirmLabel, danger })) !== null;
}

/**
 * Resolves the entered text, or null when cancelled. validate(value) returns
 * an error message to keep the dialog open.
 */
export function promptDialog({ title, message = '', label, value = '', confirmLabel = 'Lưu', validate = null }) {
  promptValidate = validate;
  return open({ title, message, confirmLabel, input: { label, value } });
}

/** Shows a message with a single button. */
export async function alertDialog({ title, message }) {
  await open({ title, message, confirmLabel: 'Đóng', cancel: false });
}

export function initConfirm() {
  const dialog = $('#confirmDialog');
  $('#confirmForm').addEventListener('submit', event => {
    event.preventDefault();
    const prompting = !$('#confirmInputWrap').hidden,
      value = prompting ? $('#confirmInput').value.trim() : true;
    const error = prompting && promptValidate ? promptValidate(value) : '';
    if (error) {
      $('#confirmError').textContent = error;
      $('#confirmInput').focus();
      return;
    }
    const done = settle;
    dialog.close();
    done?.(value);
  });
  $('#confirmCancel').onclick = () => dialog.close();
  // Escape, the cancel button and any other close count as cancelling.
  dialog.addEventListener('close', () => settle?.(null));
}
