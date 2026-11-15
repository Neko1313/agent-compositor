/** Private reason distinguishing successful UI action cleanup from cancellation. */
export const UI_ACTION_COMPLETED = Object.assign(new Error('UI action completed'), {name: 'AbortError'});
