/** @jsxImportSource @opentui/react */
import type {UiAppearance} from '@agent-compositor/events';
import {createContext,useContext,useMemo,useSyncExternalStore,type ReactNode} from 'react';
import {resolveAppearance} from './colors.js';

export interface AppearanceSnapshot {readonly revision:number;readonly appearance:UiAppearance}
export interface AppearanceSource {
  snapshot():AppearanceSnapshot;
  subscribe(listener:()=>void):()=>void;
}

const initial=Object.freeze({revision:0,appearance:Object.freeze({})});
const empty:AppearanceSource={snapshot:()=>initial,subscribe:()=>()=>{}};
const AppearanceContext=createContext(resolveAppearance());

/** Only validated decoration data crosses this boundary; native owners stay mounted. */
export function AppearanceProvider({source=empty,children}:{source?:AppearanceSource;children:ReactNode}){
  const state=useSyncExternalStore(source.subscribe,source.snapshot);
  const value=useMemo(()=>resolveAppearance(state.appearance),[state]);
  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}
export const useAppearance=()=>useContext(AppearanceContext);
