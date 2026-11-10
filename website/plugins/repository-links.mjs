import {existsSync, statSync} from 'node:fs';
import path from 'node:path';
import {pages, repository, root} from '../../tools/docs/structure.mjs';

/** Resolve repository links before Docusaurus checks the published page graph. */
export default function repositoryLinks() {
  const published = new Set(pages().map(page=>page.source));
  return (tree,file) => {
    const source = path.relative(path.join(root,'website/.content'),file.path).split(path.sep).join('/');
    const visit = node => {
      if(['link','definition','image'].includes(node.type) && typeof node.url==='string' &&
        !/^(?:[a-z][a-z\d+.-]*:|#|\/)/i.test(node.url)) {
        const match = /^([^?#]+)(.*)$/.exec(node.url);
        if(match) {
          const target=path.posix.normalize(path.posix.join(path.posix.dirname(source),decodeURIComponent(match[1])));
          if(target.startsWith('../')||!existsSync(path.join(root,target)))
            throw new Error(`${source}: repository link does not exist: ${node.url}`);
          if(!published.has(target)) {
            const kind=statSync(path.join(root,target)).isDirectory()?'tree':'blob';
            node.url=node.type==='image'
              ? `https://raw.githubusercontent.com/Neko1313/agent-compositor/main/${target}${match[2]}`
              : `${repository}/${kind}/main/${target}${match[2]}`;
          }
        }
      }
      for(const child of node.children??[])visit(child);
    };
    visit(tree);
  };
}
