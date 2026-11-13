import {connectWindowLayout as connectProductionWindowLayout} from '../../packages/app/src/opentui-windows.js';

export type {DynamicWindowLayout, WindowPane, WindowPlacement} from '../../packages/app/src/opentui-windows.js';

/** Keep the standalone preview's existing raw snapshot format. */
export const connectWindowLayout: typeof connectProductionWindowLayout = (storage, options) =>
  connectProductionWindowLayout(storage, {...options, storageFormat: options.storageFormat ?? 'raw'});
