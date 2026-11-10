import {createRequire} from 'node:module';
import {themes} from 'prism-react-renderer';
import repositoryLinks from './plugins/repository-links.mjs';
const require=createRequire(import.meta.url);

export default {
  title:'Compositor',
  tagline:'Build an agent that works your way.',
  url:'https://neko1313.github.io',
  baseUrl:'/agent-compositor/',
  organizationName:'Neko1313',
  projectName:'agent-compositor',
  trailingSlash:true,
  favicon:'img/compositor.svg',
  onBrokenLinks:'throw',
  onBrokenAnchors:'throw',
  onDuplicateRoutes:'throw',
  markdown:{format:'md',hooks:{onBrokenMarkdownLinks:'throw',onBrokenMarkdownImages:'throw'}},
  i18n:{defaultLocale:'en',locales:['en']},
  presets:[['classic',{
    docs:{path:'.content',routeBasePath:'/',sidebarPath:require.resolve('./.content/sidebars.json'),
      numberPrefixParser:false,remarkPlugins:[repositoryLinks],showLastUpdateTime:false},
    blog:false,
    theme:{customCss:require.resolve('./src/css/custom.css')},
  }]],
  themes:[['@easyops-cn/docusaurus-search-local',{
    hashed:'filename',language:'en',docsDir:'.content',docsRouteBasePath:'/',indexBlog:false,indexPages:false,
    highlightSearchTermsOnTargetPage:true,searchResultLimits:8,
  }]],
  themeConfig:{
    colorMode:{respectPrefersColorScheme:true},
    navbar:{title:'Compositor',logo:{alt:'Compositor',src:'img/compositor.svg'},items:[
      {to:'/getting-started',label:'Get started',position:'left'},
      {to:'/plugin-authoring',label:'Build extensions',position:'left'},
      {to:'/reference/plugins',label:'Plugins',position:'left'},
      {href:'https://github.com/Neko1313/agent-compositor',label:'GitHub',position:'right'},
      {label:'main branch',position:'right',to:'/releases'},
    ]},
    footer:{style:'dark',links:[
      {title:'Learn',items:[{label:'Get started',to:'/getting-started'},{label:'Architecture',to:'/architecture'}]},
      {title:'Extend',items:[{label:'Your first plugin',to:'/first-plugin'},{label:'Event catalog',to:'/events'}]},
      {title:'Contribute',items:[{label:'Development',to:'/contributing'},{label:'Improve these docs',to:'/documentation'}]},
    ],copyright:'Agent Compositor · MIT · Documentation built from the main branch'},
    prism:{theme:themes.github,darkTheme:themes.dracula,additionalLanguages:['bash','json','python','diff']},
    tableOfContents:{minHeadingLevel:2,maxHeadingLevel:3},
  },
};
