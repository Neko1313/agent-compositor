import type {UiTextView} from '@agent-compositor/events';

export interface PublicRenderSlotSnapshot {
  readonly revision:number;
  /** Host-supplied public default, used where no resident native widget exists. */
  readonly defaultView?:UiTextView;
  readonly override?:UiTextView;
}

/** Drawable public cells only; no editor, request or controller data crosses this port. */
export interface PublicRenderMeasurement {
  columns:number;
  rows:number;
  visible:boolean;
  scrollOffset:number;
  /** Only an actual scroll gesture can replace a retained logical default offset. */
  scrollOrigin?:'input'|'layout';
}

export interface PublicRenderSlotSource {
  readonly id:string;
  snapshot():PublicRenderSlotSnapshot;
  subscribe(listener:()=>void):()=>void;
  measure(metrics:PublicRenderMeasurement):void;
  press(action:string,revision:number):void;
}

export interface PublicRenderSlots {
  /** Pure lookup: each actual pane, including copies, has a stable source. */
  slot(actualPaneId:string):PublicRenderSlotSource|undefined;
}

/** Deduplicate native measurements and fence callbacks after a widget is detached. */
export function createPublicRenderMeasurements(source:Pick<PublicRenderSlotSource,'measure'>){
  let previous:PublicRenderMeasurement|undefined,disposed=false;
  const publish=(value:PublicRenderMeasurement)=>{
    if(disposed||[value.columns,value.rows,value.scrollOffset].some(n=>!Number.isFinite(n)||n<0||n>Number.MAX_SAFE_INTEGER))return false;
    const metrics={columns:Math.floor(value.columns),rows:Math.floor(value.rows),scrollOffset:Math.floor(value.scrollOffset),
      visible:value.visible===true&&value.columns>=1&&value.rows>=1,scrollOrigin:value.scrollOrigin??'layout'};
    if(metrics.scrollOrigin!=='input'&&previous&&(['columns','rows','scrollOffset','visible'] as const).every(key=>metrics[key]===previous![key]))return false;
    previous=Object.freeze(metrics);source.measure(previous);return true;
  };
  const hide=()=>publish({...previous??{columns:0,rows:0,scrollOffset:0},visible:false,scrollOrigin:'layout'});
  return {publish,hide,dispose(){if(disposed)return;hide();disposed=true;}};
}
