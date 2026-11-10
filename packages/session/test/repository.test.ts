import { describe,it,expect,vi } from "vitest";
import { SessionRepositoryRouter, type SessionRepository, validateSessionRepository } from "../src/repository.js";

function backend():SessionRepository {
  return Object.fromEntries(["create","append","load","list","search","fork","archive","rename","unarchive","remove","findByPrefix"].map(name=>[name,vi.fn(async()=>name)])) as unknown as SessionRepository;
}
describe("session repository routing",()=>{
  it("waits for in-flight writes before replacing and routes queued operations to the new backend",async()=>{
    const old=backend(),next=backend();let release!:()=>void;
    old.append=vi.fn(()=>new Promise<void>(resolve=>{release=resolve;}));old.dispose=vi.fn();
    const router=new SessionRepositoryRouter(old);
    const writing=router.append("id",[],"/project");await Promise.resolve();
    const replacing=router.replace(next),reading=router.load("id","/project");
    await Promise.resolve();expect(old.dispose).not.toHaveBeenCalled();expect(next.load).not.toHaveBeenCalled();
    release();await Promise.all([writing,replacing,reading]);
    expect(old.dispose).toHaveBeenCalledOnce();expect(next.load).toHaveBeenCalledWith("id","/project");
    expect(old.load).not.toHaveBeenCalled();await router.dispose();
  });

  it("requires a complete structural backend, propagates failures and closes once",async()=>{
    expect(()=>validateSessionRepository({append(){}})).toThrow("complete");
    const selected=backend();selected.load=vi.fn(async()=>{throw new Error("backend offline");});selected.dispose=vi.fn();
    const router=new SessionRepositoryRouter(selected);
    await expect(router.load("saved")).rejects.toThrow("backend offline");
    expect(()=>router.root("/project")).toThrow("no filesystem root");
    await Promise.all([router.dispose(),router.dispose()]);expect(selected.dispose).toHaveBeenCalledOnce();
    await expect(router.load("saved")).rejects.toThrow("closed");await expect(router.replace(backend())).rejects.toThrow("closed");
  });

  it("keeps the committed backend usable when retiring a provider fails",async()=>{
    const old=backend(),next=backend();old.dispose=()=>{throw new Error("cleanup failed");};
    const router=new SessionRepositoryRouter(old);await router.replace(next);
    expect(router.cleanupErrors).toHaveLength(1);await router.list("/project");expect(next.list).toHaveBeenCalledOnce();
  });

  it("opens a replacement only after writes drain and keeps the old backend on failed validation",async()=>{
    const old=backend(),next=backend();let release!:()=>void;
    old.append=()=>new Promise<void>(resolve=>{release=resolve;});next.dispose=vi.fn();
    const router=new SessionRepositoryRouter(old),writing=router.append("id",[]);await Promise.resolve();
    const factory=vi.fn(()=>next);
    const replacing=router.replaceWith(factory,()=>{throw new Error("invalid composition");});
    const failed=expect(replacing).rejects.toThrow("invalid composition");
    await Promise.resolve();expect(factory).not.toHaveBeenCalled();release();await writing;await failed;
    expect(next.dispose).toHaveBeenCalledOnce();await router.load("id");expect(old.load).toHaveBeenCalledOnce();
  });
});
