import {z} from 'zod';
import {questionnaireSchema,uiAppearanceSchema,uiFormSchema,uiTextViewSchema} from '@agent-compositor/events';

/** Negotiated together; legacy grid peers never receive native messages. */
export const NATIVE_PRESENTATION='native-presentation-v1';
export const NATIVE_INPUT='native-input-v1';
export const nativeProtocolElements=[NATIVE_PRESENTATION,NATIVE_INPUT] as const;
/** Optional media metadata; never required from existing native peers. */
export const COMPOSER_MEDIA_STATUS='composer-media-status-v1';
/** Optional native steering; legacy peers retain their strict method set. */
export const NATIVE_STEER='native-steer-v1';
/** Optional state for work waiting before a model turn. */
export const NATIVE_PENDING_WORK='native-pending-work-v1';
/** Optional state for a session switch that has not finished starting. */
export const NATIVE_SESSION_RESTORING='native-session-restoring-v1';
/** Optional private Main draft exchange; legacy peers do not receive its fields. */
export const NATIVE_MAIN_DRAFT='native-main-draft-v1';
/** Optional conflict and review actions for private Main drafts. */
export const NATIVE_MAIN_DRAFT_REVIEW='native-main-draft-review-v1';

const uint=z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const id=z.string().min(1).max(256);
const port=z.string().min(1).max(512);
const label=z.string().max(512);
const cells=z.number().int().min(0).max(10000);
const positiveCells=cells.min(1);
const workspace=z.number().int().min(1).max(9);
const modifiers=z.array(z.string().min(1).max(32)).max(16);
const rect=z.object({x:cells,y:cells,width:positiveCells,height:positiveCells}).strict();
const dimensions=z.object({width:positiveCells,height:positiveCells}).strict();
const direction=z.enum(['left','right','up','down']);
const edge=z.enum(['left','right','top','bottom','center']);

// Keep native.ts independent of messages.ts, which incorporates these schemas.
const controllerCell=z.object({ch:z.string().min(1).max(4),fg:z.string().optional(),bg:z.string().optional(),
  bold:z.boolean().optional(),dim:z.boolean().optional(),italic:z.boolean().optional(),underline:z.boolean().optional()}).strict();
export const nativeControllerViewSchema=uiTextViewSchema.extend({lines:z.array(uiTextViewSchema.shape.lines.element.extend({
  cells:z.array(controllerCell).optional(),
})).max(2000)});
const controllerFields={id,revision:uint,inputRevision:uint,view:nativeControllerViewSchema,preferredRows:positiveCells};
export const nativeControllerSchema=z.object({...controllerFields,kind:z.enum(['approval','question','form','history','placement'])}).strict();
export const nativeEditorSchema=z.object({...controllerFields,kind:z.literal('editor'),available:z.boolean(),
  admission:z.object({sequence:uint,type:z.enum(['submit','steer']),status:z.enum(['accepted','queued','rejected'])}).strict().optional(),
  scroll:z.object({revision:uint,rows:z.number().finite()}).strict().optional(),
}).strict();
const approval=z.object({id,tool:z.string(),reason:z.string(),details:z.array(z.object({label:z.string(),value:z.string()}).strict())}).strict();
const question=z.object({id,kind:z.literal('question'),request:questionnaireSchema,error:z.string().optional()}).strict();
const form=z.object({id,kind:z.literal('form'),plugin:id,request:uiFormSchema,error:z.string().optional()}).strict();
export const nativeInteractionSchema=z.discriminatedUnion('kind',[question,form]);
const message=z.union([
  z.object({role:z.enum(['user','assistant']),text:z.string()}).strict(),
  z.object({role:z.literal('tool'),text:z.string(),tool:z.object({callId:z.string(),name:z.string(),args:z.string().optional(),
    state:z.enum(['running','done','error','complete'])}).strict()}).strict(),
]);
/** Transcript size remains the existing host contract; no history is silently dropped. */
export const nativeConversationSnapshotSchema=z.object({messages:z.array(message),running:z.boolean(),restoring:z.boolean().optional(),pending:z.boolean().optional(),error:z.string().optional(),notice:z.string().optional(),
  approval:approval.optional(),interaction:nativeInteractionSchema.optional(),
  draft:z.object({revision:uint,text:z.string().max(64000),status:z.enum(['draft','review','conflict','loading','error']),
    variants:z.array(z.object({id,kind:z.enum(['draft','review','journal']),text:z.string().max(64000)}).strict()).max(256).optional()}).strict().optional(),
  controller:nativeControllerSchema.extend({kind:z.enum(['approval','question','form'])}).optional(),
  editor:nativeEditorSchema.optional(),
}).strict();

export const nativeSessionMethods=['submit','steer','draftChange','draftReview','draftResolve','draftRefresh','isImmediateCommand','interrupt','answerApproval','answerInteraction','cancelInteraction',
  'controllerInput','controllerViewport','cancelController','editorInput','editorViewport'] as const;
export const nativeSurfaceMethods=['press','change','answerApproval','answerInteraction','cancelInteraction','answerForm','cancelForm',
  'controllerInput','controllerViewport','cancelController'] as const;
export const nativeSessionSchema=z.object({port,id,conversationId:id.optional(),generation:z.union([id,uint]).optional(),paneId:id.optional(),label,
  current:z.boolean(),methods:z.array(z.enum(nativeSessionMethods)).max(nativeSessionMethods.length).optional(),snapshot:nativeConversationSnapshotSchema}).strict();
export const nativeSurfaceSnapshotSchema=z.object({revision:uint,title:label,view:uiTextViewSchema.optional(),approval:approval.optional(),
  interaction:nativeInteractionSchema.optional(),controller:nativeControllerSchema.optional(),form:form.optional(),busy:z.boolean().optional(),error:z.string().optional()}).strict();
export const nativeSurfaceSchema=z.object({port,id,methods:z.array(z.enum(nativeSurfaceMethods)).max(nativeSurfaceMethods.length).optional(),snapshot:nativeSurfaceSnapshotSchema}).strict();
const splitTarget=z.object({axis:z.enum(['horizontal','vertical']),ratio:z.number().min(0).max(1),focusedChild:z.union([z.literal(0),z.literal(1)]),
  children:z.tuple([z.array(id).max(256),z.array(id).max(256)]),visibility:z.enum(['visible','size-limited','compact','zoomed','unmeasured']),
  bounds:rect.optional(),divider:rect.optional()}).strict();
export const nativeLayoutSchema=z.object({revision:uint,width:cells,height:cells,
  frames:z.array(rect.extend({surface:id})).max(256),focused:z.string().max(256),workspace,workspaces:z.array(workspace).max(9),
  locations:z.record(id,workspace).refine(value=>Object.keys(value).length<=256,'Too many window locations'),
  axis:z.enum(['horizontal','vertical']),fullscreen:z.boolean(),compact:z.boolean(),splitTarget:splitTarget.optional(),
  pointer:z.enum(['default','grab','grabbing','ew-resize','ns-resize']),drop:z.object({surface:id,edge}).strict().optional(),
  dragging:id.optional(),gesture:z.enum(['move','resize']).optional(),saving:z.boolean().optional(),error:z.string().optional(),
}).strict();
export const nativeNavigationSchema=z.object({revision:uint,mode:z.enum(['normal','arrange','finder']),query:z.string(),
  entries:z.array(z.object({id,title:label,workspace:workspace.optional(),state:z.enum(['open','closed','available','unavailable'])}).strict()),
  selected:id.optional(),focusedLabel:label.optional(),error:z.string().optional(),opening:id.optional(),selectionRevision:uint.optional()}).strict();
export const nativePublicRenderSchema=z.object({port,id,revision:uint,defaultView:uiTextViewSchema.optional(),override:uiTextViewSchema.optional()}).strict();
export const nativeStateSchema=z.object({
  sessions:z.array(nativeSessionSchema).max(256),
  windows:z.array(z.object({id,label,session:port}).strict()).max(256),
  surfaces:z.array(nativeSurfaceSchema).max(256),layout:nativeLayoutSchema,navigation:nativeNavigationSchema.optional(),
  appearance:z.object({revision:uint,appearance:uiAppearanceSchema}).strict().optional(),
  publicRender:z.array(nativePublicRenderSchema).max(257),composerMedia:dimensions.optional(),immediateCommands:z.array(z.string().min(1)),
}).strict().superRefine((state,context)=>{
  const unique=(values:string[],path:string)=>{if(new Set(values).size!==values.length)context.addIssue({code:'custom',message:'Duplicate native identity',path:[path]});};
  unique([...state.sessions.map(value=>value.port),...state.surfaces.map(value=>value.port),...state.publicRender.map(value=>value.port)],'sessions');
  unique(state.windows.map(value=>value.id),'windows');unique(state.surfaces.map(value=>value.id),'surfaces');unique(state.publicRender.map(value=>value.id),'publicRender');
  unique(state.layout.frames.map(value=>value.surface),'layout');
  const sessions=new Set(state.sessions.map(value=>value.port));
  if(state.windows.some(value=>!sessions.has(value.session)))context.addIssue({code:'custom',message:'Window references an unknown native session port',path:['windows']});
});
export const nativeStateMessage=z.object({type:z.literal('native-state'),epoch:id,revision:uint,state:nativeStateSchema}).strict();

export const nativeControllerInputSchema=z.discriminatedUnion('kind',[
  z.object({kind:z.literal('key'),key:z.string().min(1).max(128),modifiers:modifiers.optional()}).strict(),
  z.object({kind:z.literal('text'),text:z.string(),paste:z.literal(true).optional()}).strict(),
  z.object({kind:z.literal('mouse'),row:cells,col:cells,button:z.string().min(1).max(32),action:z.enum(['press','move','release']).optional()}).strict(),
  z.object({kind:z.literal('action'),action:z.string().min(1).max(64)}).strict(),
  z.object({kind:z.literal('change'),id:z.string().min(1).max(64),value:z.string().max(4000)}).strict(),
]);
export const nativeNavigationInputSchema=z.discriminatedUnion('kind',[
  z.object({kind:z.literal('key'),key:z.string().min(1).max(128),text:z.string().optional(),modifiers:modifiers.optional(),repeated:z.boolean().optional()}).strict(),
  z.object({kind:z.literal('paste'),text:z.string()}).strict(),
]);
export const nativeLayoutActionSchema=z.discriminatedUnion('type',[
  z.object({type:z.enum(['open','focus']),id}).strict(),z.object({type:z.literal('cycle'),reverse:z.boolean().optional()}).strict(),
  z.object({type:z.literal('axis'),axis:z.enum(['horizontal','vertical'])}).strict(),
  z.object({type:z.enum(['orient','swap','zoom','close'])}).strict(),
  z.object({type:z.literal('resize'),delta:z.number().finite()}).strict(),
  z.object({type:z.literal('direction'),key:direction,move:z.boolean().optional()}).strict(),
  z.object({type:z.literal('retile'),key:direction}).strict(),
  z.object({type:z.enum(['workspace','moveWorkspace']),id:workspace}).strict(),
  z.object({type:z.literal('pointer'),phase:z.enum(['down','move','up','cancel']),x:z.number().int().min(-10000).max(10000),y:z.number().int().min(-10000).max(10000),
    kind:z.enum(['title','pane','separator']).optional(),revision:uint.optional(),workspace:workspace.optional()}).strict(),
]);
export const nativeMeasurementSchema=z.object({columns:cells,rows:cells,visible:z.boolean(),scrollOffset:uint,scrollOrigin:z.enum(['input','layout']).optional()}).strict();
// Only explicit interaction answers have an open JSON value; the broker still
// validates it against the originally admitted request before any effect.
const answer=z.json();
export const nativeOperationSchema=z.discriminatedUnion('kind',[
  z.object({kind:z.literal('submit'),text:z.string()}).strict(),z.object({kind:z.literal('steer'),text:z.string()}).strict(),z.object({kind:z.literal('interrupt')}).strict(),
  z.object({kind:z.literal('draft-change'),text:z.string().max(64000),revision:uint}).strict(),
  z.object({kind:z.literal('draft-review'),revision:uint}).strict(),
  z.object({kind:z.literal('draft-resolve'),ids:z.array(id).max(256),text:z.string().max(64000),revision:uint}).strict(),
  z.object({kind:z.literal('draft-refresh'),revision:uint}).strict(),
  z.object({kind:z.literal('approval'),id,allow:z.boolean()}).strict(),
  z.object({kind:z.literal('interaction'),id,value:answer}).strict(),z.object({kind:z.literal('cancel-interaction'),id}).strict(),
  z.object({kind:z.literal('controller-input'),id,input:nativeControllerInputSchema,revision:uint}).strict(),
  z.object({kind:z.literal('controller-viewport'),id,columns:positiveCells,rows:positiveCells,maxRows:positiveCells.optional()}).strict(),
  z.object({kind:z.literal('cancel-controller'),id}).strict(),
  z.object({kind:z.literal('editor-input'),id,input:nativeControllerInputSchema,revision:uint}).strict(),
  z.object({kind:z.literal('editor-viewport'),id,columns:positiveCells,rows:positiveCells,maxRows:positiveCells.optional()}).strict(),
  z.object({kind:z.literal('layout-resize'),width:cells,height:cells}).strict(),
  z.object({kind:z.literal('layout-action'),action:nativeLayoutActionSchema}).strict(),
  z.object({kind:z.literal('navigation-handle'),input:nativeNavigationInputSchema}).strict(),
  z.object({kind:z.enum(['navigation-toggle','navigation-open'])}).strict(),
  z.object({kind:z.literal('navigation-choose'),id,revision:uint}).strict(),
  z.object({kind:z.literal('navigation-query'),text:z.string(),revision:uint}).strict(),
  z.object({kind:z.literal('navigation-select'),id,revision:uint}).strict(),
  z.object({kind:z.literal('surface-press'),action:z.string().min(1).max(64),revision:uint}).strict(),
  z.object({kind:z.literal('surface-change'),field:z.string().min(1).max(64),value:z.string().max(4000),revision:uint}).strict(),
  z.object({kind:z.literal('public-measure'),metrics:nativeMeasurementSchema}).strict(),
  z.object({kind:z.literal('public-press'),action:z.string().min(1).max(64),revision:uint}).strict(),
  z.object({kind:z.literal('media-active'),enabled:z.boolean(),active:z.boolean(),expanded:z.boolean().optional()}).strict(),
  z.object({kind:z.literal('ctrl-c')}).strict(),
]);
export const nativeInputMessage=z.object({type:z.literal('native-input'),epoch:id,id:uint,target:port,revision:uint.optional(),operation:nativeOperationSchema}).strict();
/** Admission is separate from asynchronous controller or model completion. */
export const nativeReceiptMessage=z.object({type:z.literal('native-receipt'),epoch:id,id:uint,status:z.enum(['accepted','rejected']),
  ticket:uint.optional(),consumed:z.boolean().optional(),ctrlC:z.enum(['exit','handled']).optional()}).strict()
  .refine(value=>value.status!=='rejected'||value.ticket===undefined,'Rejected input cannot acquire a ticket');
const mediaFrame=z.object({width:z.number().int().min(1).max(512),height:z.number().int().min(1).max(512),
  rgba:z.string().max(1398104).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
}).strict().refine(value=>value.rgba.length/4*3-(value.rgba.endsWith('==')?2:value.rgba.endsWith('=')?1:0)===value.width*value.height*4,'RGBA length must match dimensions');
export const nativeMediaPresentationSchema=z.object({label:label.optional(),alt:label.optional(),hasImage:z.boolean()}).strict();
export const nativeMediaMessage=z.object({type:z.literal('native-media'),epoch:id,revision:uint,dimensions,frame:mediaFrame.optional(),
  presentation:nativeMediaPresentationSchema.optional()}).strict();

export type NativeState=z.infer<typeof nativeStateSchema>;
export type NativeSession=z.infer<typeof nativeSessionSchema>;
export type NativeSurface=z.infer<typeof nativeSurfaceSchema>;
export type NativeOperation=z.infer<typeof nativeOperationSchema>;
export type NativeStateMessage=z.infer<typeof nativeStateMessage>;
export type NativeInputMessage=z.infer<typeof nativeInputMessage>;
export type NativeReceiptMessage=z.infer<typeof nativeReceiptMessage>;
export type NativeMediaMessage=z.infer<typeof nativeMediaMessage>;
