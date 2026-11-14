import {expect,it} from 'vitest';
import {appearanceText,color,nativeColor,resolveAppearance} from '../src/colors.js';

it('keeps native defaults and conversation identities when no contribution supplies a field',()=>{
  const theme=resolveAppearance();
  expect(theme.color).toEqual(color);
  expect(theme.presentation).toEqual({userLabel:'You',agentLabel:undefined,welcome:'No messages yet',toolDetails:false,hints:true,showTools:false});
  expect(theme.chrome).toEqual({borderStyle:'single',controls:'focus'});
  expect(theme.customText).toBe(false);
  expect(resolveAppearance({colors:{accent:'#123456'}}).color).toEqual({...color,accent:'#123456'});
});

it('maps every portable color independently, including success and explicit selection contrast',()=>{
  const theme=resolveAppearance({colors:{text:'#010101',muted:'#020202',accent:'#030303',success:'#040404',warning:'#050505',danger:'#060606',
    border:'#070707',titleBackground:'#080808',selectionBackground:'#090909',selectionText:'#101010'}});
  expect(theme.color).toEqual({...color,text:'#010101',muted:'#020202',accent:'#030303',success:'#040404',running:'#050505',error:'#060606',
    rule:'#070707',titleBackground:'#080808',selectionBackground:'#090909',selectionText:'#101010',actionBackground:'#090909',optionBackground:'#090909',actionText:'#101010'});
  expect(theme.tones).toEqual({text:'#010101',muted:'#020202',accent:'#030303',success:'#040404',warning:'#050505',danger:'#060606'});
  expect(theme.customText).toBe(true);
});

it('normalizes all portable bright names before passing them to the native parser',()=>{
  for(const name of ['black','red','green','yellow','blue','magenta','cyan','white']){
    expect(nativeColor(name+'Bright')).toBe('bright'+name);
    expect(resolveAppearance({colors:{warning:(name+'Bright') as 'redBright'}}).color.running).toBe('bright'+name);
    expect(nativeColor(name)).toBe(name);
  }
  expect(nativeColor('gray')).toBe('gray');expect(nativeColor('grey')).toBe('grey');
  expect(nativeColor('#aAbBcC')).toBe('#aAbBcC');
});

it('resolves independent immutable themes without mutating the source or another renderer',()=>{
  const patch={colors:{accent:'#123456'},chrome:{borderStyle:'round' as const},presentation:{userLabel:'Human',agentLabel:'Builder'}};
  const first=resolveAppearance(patch),second=resolveAppearance({colors:{accent:'#abcdef'}});
  patch.colors.accent='#999999';patch.presentation.agentLabel='Changed';
  expect(first.color.accent).toBe('#123456');expect(first.presentation.agentLabel).toBe('Builder');
  expect(first.chrome.borderStyle).toBe('rounded');expect(second.color.accent).toBe('#abcdef');
  expect(Object.isFrozen(first)&&Object.isFrozen(first.color)&&Object.isFrozen(first.presentation)).toBe(true);
  expect(color.accent).toBe('#a6dfd4');
});

it('honors empty presentation strings and false flags without treating them as missing',()=>{
  const theme=resolveAppearance({chrome:{borderStyle:'double',controls:'always'},
    presentation:{userLabel:'',agentLabel:'',welcome:'',toolDetails:true,hints:false,showTools:true}});
  expect(theme.chrome).toEqual({borderStyle:'double',controls:'always'});
  expect(theme.presentation).toEqual({userLabel:'',agentLabel:'',welcome:'',toolDetails:true,hints:false,showTools:true});
});

it('keeps multiline welcome literal while exposing control and directional formatting in labels',()=>{
  const theme=resolveAppearance({presentation:{userLabel:'User\n\x1b',agentLabel:'A\u202eB',welcome:'First\nSecond\x1b[31m'}});
  expect(theme.presentation.userLabel).toBe('User\\u000a\\u001b');
  expect(theme.presentation.agentLabel).toBe('A\\u202eB');
  expect(theme.presentation.welcome).toBe('First\nSecond\\u001b[31m');
  expect(appearanceText('Title\tX')).toBe('Title\\u0009X');
});

it('rejects an invalid decoration snapshot as a whole before native parsing',()=>{
  for(const patch of [{colors:{accent:'\x1b[31m'}},{chrome:{borderStyle:'arbitrary'}},{presentation:{agentLabel:()=>null}},{unknown:'ignored?'}])
    expect(resolveAppearance(patch as never)).toEqual(resolveAppearance());
});
