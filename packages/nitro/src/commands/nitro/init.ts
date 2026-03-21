import { Command, Flags, Args } from '@oclif/core';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { logger, colors, printNitroBanner, promptInput, promptSelect, printGradientBar, printInfoBox, printStep } from '@cloudcart/cli-kit';
import { exec } from '../../lib/project.js';

export default class NitroInit extends Command {
  static override description = 'Create a new Nitro storefront project';

  static override examples = [
    '<%= config.bin %> nitro init my-store',
    '<%= config.bin %> nitro init my-store --quickstart',
  ];

  static override args = {
    name: Args.string({ description: 'Project directory name' }),
  };

  static override flags = {
    quickstart: Flags.boolean({
      description: 'Use defaults (mock store, TypeScript, npm)',
      default: false,
    }),
    'package-manager': Flags.string({
      description: 'Package manager to use',
      options: ['npm', 'pnpm', 'yarn'],
    }),
    language: Flags.string({
      description: 'Language',
      options: ['ts', 'js'],
    }),
    'no-install': Flags.boolean({ description: 'Skip dependency installation', default: false }),
    'no-git': Flags.boolean({ description: 'Skip git initialization', default: false }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(NitroInit);

    printNitroBanner();

    // ── Interactive prompts (skipped with --quickstart) ──

    const isQuickstart = flags.quickstart;

    // Project name
    let projectName = args.name;
    if (!projectName && !isQuickstart) {
      projectName = await promptInput('Project name:');
    }
    projectName = projectName?.trim() || 'my-nitro-store';
    const projectPath = resolve(projectName);

    if (existsSync(projectPath)) {
      logger.error(`Directory "${projectName}" already exists.`);
      this.exit(1);
    }

    // Store connection
    let storeMode: string;
    let storeDomain = '';
    if (isQuickstart) {
      storeMode = 'Mock store (demo data)';
    } else {
      storeMode = await promptSelect('Store:', [
        'Mock store (demo data)',
        'Connect to a CloudCart store',
      ]);
    }

    if (storeMode.startsWith('Connect')) {
      storeDomain = await promptInput('Store domain (e.g., mystore.cloudcart.com):');
      storeDomain = storeDomain.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
    }

    // Language
    let language = flags.language;
    if (!language && !isQuickstart) {
      const langChoice = await promptSelect('Language:', ['TypeScript', 'JavaScript']);
      language = langChoice.startsWith('Type') ? 'ts' : 'js';
    }
    language = language || 'ts';

    // Package manager
    let pm = flags['package-manager'];
    if (!pm && !isQuickstart) {
      pm = await promptSelect('Package manager:', ['npm', 'pnpm', 'yarn']);
    }
    pm = pm || 'npm';

    // ── Summary ──

    printInfoBox('Configuration', [
      `Store:      ${colors.bold(storeDomain || 'Mock store (demo data)')}`,
      `Language:   ${colors.bold(language === 'ts' ? 'TypeScript' : 'JavaScript')}`,
      `Package:    ${colors.bold(pm)}`,
      `Path:       ${colors.dim(projectPath)}`,
    ]);
    console.log();

    // ── Scaffold ──

    printStep(1, 'Setting up project ...');
    printGradientBar();
    mkdirSync(projectPath, { recursive: true });
    this.scaffoldProject(projectPath, projectName, storeDomain, language);
    console.log();

    // ── Git ──

    if (!flags['no-git']) {
      printStep(2, 'Initializing git ...');
      await exec('git', ['init', '-q'], projectPath);
      console.log();
    }

    // ── Install ──

    if (!flags['no-install']) {
      printStep(flags['no-git'] ? 2 : 3, 'Installing dependencies. This could take a few minutes ...');
      printGradientBar();
      await exec(pm, ['install'], projectPath);
      console.log();
    }

    // ── Route summary ──

    printGradientBar();
    console.log();
    console.log(colors.bold('  Storefront:  ') + colors.brand(storeDomain || 'Mock.shop'));
    console.log(colors.bold('  Language:    ') + (language === 'ts' ? 'TypeScript' : 'JavaScript'));
    console.log();
    console.log(colors.bold('  Routes:'));
    const routes: [string, string][] = [
      ['Home',        '/ & /:catchAll'],
      ['Products',    '/products/:handle'],
      ['Collections', '/collections & /collections/:handle'],
      ['Cart',        '/cart/* & /discount/*'],
      ['Search',      '/search'],
      ['Pages',       '/pages/:handle'],
      ['Blogs',       '/blogs/*'],
      ['Policies',    '/policies & /policies/:handle'],
      ['Robots',      '/robots.txt'],
      ['Sitemap',     '/sitemap.xml'],
    ];
    for (const [name, paths] of routes) {
      console.log(`    ${colors.success('•')} ${name} ${colors.dim(`(${paths})`)}`);
    }
    console.log();

    printInfoBox('Next steps', [
      colors.bold(`cd ${projectName}`),
      colors.bold('cloudcart nitro dev'),
      ...(storeDomain ? [] : [
        '',
        colors.dim('To connect to a real CloudCart store:'),
        colors.bold('cloudcart nitro link'),
        colors.bold('cloudcart nitro env pull'),
      ]),
    ]);
    console.log();
  }

  private scaffoldProject(
    projectPath: string,
    name: string,
    storeDomain: string,
    language: string,
  ): void {
    const ext = language === 'ts' ? 'tsx' : 'jsx';
    const configExt = language === 'ts' ? 'ts' : 'js';

    // ── package.json ──
    const pkg: Record<string, unknown> = {
      name,
      private: true,
      sideEffects: false,
      version: '0.0.0',
      type: 'module',
      scripts: {
        build: 'react-router build',
        dev: 'react-router dev',
        preview: 'vite preview',
        typecheck: 'react-router typegen && tsc --noEmit',
      },
      dependencies: {
        '@cloudcart/nitro': '^0.1.0',
        '@cloudcart/nitro-react': '^0.1.0',
        isbot: '^5.1.22',
        react: '^19.1.0',
        'react-dom': '^19.1.0',
        'react-router': '^7.12.0',
      },
      devDependencies: {
        '@react-router/dev': '^7.12.0',
        '@react-router/fs-routes': '^7.12.0',
        ...(language === 'ts' ? {
          '@types/react': '^19.1.0',
          '@types/react-dom': '^19.1.0',
          typescript: '^5.9.2',
        } : {}),
        vite: '^6.2.4',
        'vite-tsconfig-paths': '^4.3.1',
      },
      engines: { node: '^22 || ^24' },
    };
    writeFileSync(resolve(projectPath, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');

    // ── tsconfig.json (TypeScript only) ──
    if (language === 'ts') {
      const tsconfig = {
        include: ['env.d.ts', 'app/**/*.ts', 'app/**/*.tsx', '*.ts', '*.tsx', '.react-router/types/**/*'],
        exclude: ['node_modules', 'dist', 'build'],
        compilerOptions: {
          lib: ['DOM', 'DOM.Iterable', 'ES2022'],
          isolatedModules: true, esModuleInterop: true, jsx: 'react-jsx',
          moduleResolution: 'Bundler', resolveJsonModule: true,
          module: 'ES2022', target: 'ES2022', strict: true, allowJs: true,
          forceConsistentCasingInFileNames: true, skipLibCheck: true,
          baseUrl: '.', types: ['react-router', 'vite/client'],
          paths: { '~/*': ['app/*'] }, noEmit: true,
          rootDirs: ['.', './.react-router/types'],
          verbatimModuleSyntax: true,
        },
      };
      writeFileSync(resolve(projectPath, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2) + '\n');

      writeFileSync(resolve(projectPath, 'env.d.ts'), ENV_D_TS);
    }

    // ── vite.config ──
    writeFileSync(resolve(projectPath, `vite.config.${configExt}`), VITE_CONFIG);

    // ── react-router.config ──
    writeFileSync(resolve(projectPath, `react-router.config.${configExt}`), REACT_ROUTER_CONFIG(language));

    // ── .env ──
    writeFileSync(resolve(projectPath, '.env'), dotEnv(storeDomain));

    // ── .gitignore ──
    writeFileSync(resolve(projectPath, '.gitignore'), GITIGNORE);

    // ── server ──
    writeFileSync(resolve(projectPath, `server.${configExt}`), SERVER_TS);

    // ── app directories ──
    for (const dir of ['app/routes', 'app/components', 'app/lib', 'app/styles', 'public']) {
      mkdirSync(resolve(projectPath, dir), { recursive: true });
    }

    // ── app files ──
    writeFileSync(resolve(projectPath, `app/routes.${configExt}`), ROUTES_TS);
    writeFileSync(resolve(projectPath, 'app/lib/context.ts'), CONTEXT_TS);
    writeFileSync(resolve(projectPath, `app/entry.client.${ext}`), ENTRY_CLIENT);
    writeFileSync(resolve(projectPath, `app/entry.server.${ext}`), ENTRY_SERVER);
    writeFileSync(resolve(projectPath, `app/root.${ext}`), ROOT_TSX);

    // ── routes ──
    writeFileSync(resolve(projectPath, `app/routes/_index.${ext}`), ROUTE_INDEX);
    writeFileSync(resolve(projectPath, `app/routes/products._index.${ext}`), ROUTE_PRODUCTS_INDEX);
    writeFileSync(resolve(projectPath, `app/routes/products.\$handle.${ext}`), ROUTE_PRODUCT);
    writeFileSync(resolve(projectPath, `app/routes/collections._index.${ext}`), ROUTE_COLLECTIONS_INDEX);
    writeFileSync(resolve(projectPath, `app/routes/collections.\$handle.${ext}`), ROUTE_COLLECTION);
    writeFileSync(resolve(projectPath, `app/routes/cart.${ext}`), ROUTE_CART);
    writeFileSync(resolve(projectPath, `app/routes/search.${ext}`), ROUTE_SEARCH);
    writeFileSync(resolve(projectPath, `app/routes/pages.\$handle.${ext}`), ROUTE_PAGE);
    writeFileSync(resolve(projectPath, `app/routes/blogs._index.${ext}`), ROUTE_BLOGS_INDEX);
    writeFileSync(resolve(projectPath, `app/routes/blogs.\$blogHandle._index.${ext}`), ROUTE_BLOG);
    writeFileSync(resolve(projectPath, `app/routes/blogs.\$blogHandle.\$articleHandle.${ext}`), ROUTE_ARTICLE);
    writeFileSync(resolve(projectPath, `app/routes/policies._index.${ext}`), ROUTE_POLICIES_INDEX);
    writeFileSync(resolve(projectPath, `app/routes/policies.\$handle.${ext}`), ROUTE_POLICY);
    writeFileSync(resolve(projectPath, `app/routes/discount.\$code.${ext}`), ROUTE_DISCOUNT);
    writeFileSync(resolve(projectPath, `app/routes/[robots.txt].${ext}`), ROUTE_ROBOTS);
    writeFileSync(resolve(projectPath, `app/routes/[sitemap.xml].${ext}`), ROUTE_SITEMAP);
    writeFileSync(resolve(projectPath, `app/routes/\$.${ext}`), ROUTE_CATCHALL);

    // ── public ──
    writeFileSync(resolve(projectPath, 'public/favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">N</text></svg>\n');
  }
}

// ── Template strings ──────────────────────────────────────────────────

function dotEnv(storeDomain: string) {
  return `SESSION_SECRET=nitro-dev-secret-change-me
PUBLIC_STORE_DOMAIN=${storeDomain || 'localhost'}
# Leave empty for mock data, fill to connect to real store:
PUBLIC_STOREFRONT_API_TOKEN=
PRIVATE_STOREFRONT_API_TOKEN=
`;
}

const ENV_D_TS = `/// <reference types="vite/client" />
/// <reference types="react-router" />

declare module "react-router" {
  interface AppLoadContext {
    env: {
      SESSION_SECRET: string;
      PUBLIC_STORE_DOMAIN?: string;
      PUBLIC_STOREFRONT_API_TOKEN?: string;
      PRIVATE_STOREFRONT_API_TOKEN?: string;
    };
    storefront: import("@cloudcart/nitro").StorefrontClient;
    cart: import("@cloudcart/nitro").CartHandler;
    session: import("@cloudcart/nitro").AppSession;
  }
}
`;

const VITE_CONFIG = `import {defineConfig} from 'vite';
import {reactRouter} from '@react-router/dev/vite';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [reactRouter(), tsconfigPaths()],
  build: {assetsInlineLimit: 0},
  ssr: {
    noExternal: true,
    target: 'webworker',
    resolve: {conditions: ['worker', 'workerd']},
    optimizeDeps: {
      include: ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom', 'react-dom/server', 'react-router'],
    },
  },
});
`;

const REACT_ROUTER_CONFIG = (lang: string) =>
  lang === 'ts'
    ? `import type {Config} from '@react-router/dev/config';\n\nexport default {ssr: true} satisfies Config;\n`
    : `export default {ssr: true};\n`;

const GITIGNORE = `node_modules
dist
build
.react-router
.env
*.local
.DS_Store
.cloudcart/
`;

const SERVER_TS = `import {createRequestHandler} from 'react-router';
import {createNitroContext} from '@cloudcart/nitro';

const handler = createRequestHandler(
  // @ts-expect-error — virtual module
  () => import('virtual:react-router/server-build'),
  'production',
);

export default {
  async fetch(request, env) {
    try {
      const context = await createNitroContext({
        request,
        env: {
          SESSION_SECRET: env.SESSION_SECRET ?? 'nitro-dev-secret',
          PUBLIC_STORE_DOMAIN: env.PUBLIC_STORE_DOMAIN,
          PUBLIC_STOREFRONT_API_TOKEN: env.PUBLIC_STOREFRONT_API_TOKEN,
          PRIVATE_STOREFRONT_API_TOKEN: env.PRIVATE_STOREFRONT_API_TOKEN,
        },
      });

      const response = await handler(request, context);

      if (context.session.isPending) {
        response.headers.set('Set-Cookie', await context.session.commit());
      }

      return response;
    } catch (error) {
      console.error(error);
      return new Response('An unexpected error occurred', {status: 500});
    }
  },
};
`;

const ROUTES_TS = `import {type RouteConfig} from '@react-router/dev/routes';
import {flatRoutes} from '@react-router/fs-routes';

export default flatRoutes() satisfies RouteConfig;
`;

const CONTEXT_TS = `export type {NitroContext} from '@cloudcart/nitro';
export {getContext, createNitroContext} from '@cloudcart/nitro';
`;

const ENTRY_CLIENT = `import {HydratedRouter} from 'react-router/dom';
import {startTransition, StrictMode} from 'react';
import {hydrateRoot} from 'react-dom/client';

startTransition(() => {
  hydrateRoot(document, <StrictMode><HydratedRouter /></StrictMode>);
});
`;

const ENTRY_SERVER = `import type {EntryContext} from 'react-router';
import {ServerRouter} from 'react-router';
import {renderToReadableStream} from 'react-dom/server';
import {isbot} from 'isbot';

export default async function handleRequest(
  request: Request, responseStatusCode: number, responseHeaders: Headers, routerContext: EntryContext,
) {
  const body = await renderToReadableStream(
    <ServerRouter context={routerContext} url={request.url} />,
    {onError(error: unknown) { console.error(error); responseStatusCode = 500; }},
  );
  if (isbot(request.headers.get('user-agent') ?? '')) await body.allReady;
  responseHeaders.set('Content-Type', 'text/html');
  return new Response(body, {headers: responseHeaders, status: responseStatusCode});
}
`;

const ROOT_TSX = `import {Links, Meta, Outlet, Scripts, ScrollRestoration, useRouteLoaderData, useRouteError, isRouteErrorResponse, type MetaFunction} from 'react-router';
import type {Route} from './+types/root';
import {getContext} from '~/lib/context';
import {getSeoMeta} from '@cloudcart/nitro';

export const meta: MetaFunction = () => getSeoMeta({title: 'Nitro | Modern Commerce'});

export const shouldRevalidate: Route.ShouldRevalidateFunction = ({formMethod, currentUrl, nextUrl}) => {
  if (formMethod && formMethod !== 'GET') return true;
  if (currentUrl.toString() === nextUrl.toString()) return true;
  return false;
};

export async function loader({context, request}: Route.LoaderArgs) {
  const ctx = await getContext(context, request);
  const [shop, headerMenu] = await Promise.all([
    ctx.storefront.getShop(),
    ctx.storefront.getMenu('main-menu'),
  ]);
  return {shop, headerMenu};
}

export function Layout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en">
      <head><meta charSet="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><Meta /><Links /></head>
      <body>{children}<ScrollRestoration /><Scripts /></body>
    </html>
  );
}

export default function App() {
  const data = useRouteLoaderData<typeof loader>('root');
  return <main><Outlet /></main>;
}

export function ErrorBoundary() {
  const error = useRouteError();
  let msg = 'Unknown error', status = 500;
  if (isRouteErrorResponse(error)) { msg = error.data?.message ?? error.statusText; status = error.status; }
  else if (error instanceof Error) { msg = error.message; }
  return <div style={{textAlign:'center',padding:'3rem'}}><h1>{status}</h1><p>{msg}</p></div>;
}
`;

const ROUTE_INDEX = `import {useLoaderData, Link} from 'react-router';
import type {Route} from './+types/_index';
import {getContext} from '~/lib/context';
import {getSeoMeta} from '@cloudcart/nitro';
import {Money, Image} from '@cloudcart/nitro-react';

export const meta: Route.MetaFunction = () => getSeoMeta({title: 'Nitro | Home'});

export async function loader({context, request}: Route.LoaderArgs) {
  const ctx = await getContext(context, request);
  const products = await ctx.storefront.getProducts(4);
  return {products};
}

export default function Homepage() {
  const {products} = useLoaderData<typeof loader>();
  return (
    <div>
      <h1>Welcome to Nitro</h1>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(250px,1fr))',gap:'1.5rem',marginTop:'1rem'}}>
        {products.map((p) => (
          <Link key={p.id} to={\`/products/\${p.handle}\`} style={{textDecoration:'none',color:'inherit'}}>
            <Image data={p.featuredImage} alt={p.title} />
            <h3>{p.title}</h3>
            <Money data={p.priceRange.minVariantPrice} />
          </Link>
        ))}
      </div>
    </div>
  );
}
`;

const ROUTE_PRODUCTS_INDEX = `import {useLoaderData, Link} from 'react-router';
import type {Route} from './+types/products._index';
import {getContext} from '~/lib/context';
import {getSeoMeta} from '@cloudcart/nitro';
import {Money, Image} from '@cloudcart/nitro-react';

export const meta: Route.MetaFunction = () => getSeoMeta({title: 'Nitro | Products'});

export async function loader({context, request}: Route.LoaderArgs) {
  const ctx = await getContext(context, request);
  const products = await ctx.storefront.getProducts();
  return {products};
}

export default function ProductsIndex() {
  const {products} = useLoaderData<typeof loader>();
  return (
    <div>
      <h1>Products</h1>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(250px,1fr))',gap:'1.5rem'}}>
        {products.map((p) => (
          <Link key={p.id} to={\`/products/\${p.handle}\`} style={{textDecoration:'none',color:'inherit'}}>
            <Image data={p.featuredImage} alt={p.title} />
            <h3>{p.title}</h3>
            <Money data={p.priceRange.minVariantPrice} />
          </Link>
        ))}
      </div>
    </div>
  );
}
`;

const ROUTE_PRODUCT = `import {useLoaderData, data, Link} from 'react-router';
import type {Route} from './+types/products.$handle';
import {getContext} from '~/lib/context';
import {getSeoMeta} from '@cloudcart/nitro';
import {Image, ProductPrice, AddToCartButton, RichText, VariantSelector, useOptimisticVariant} from '@cloudcart/nitro-react';

export const meta: Route.MetaFunction = ({data: d}) => getSeoMeta({title: d?.product ? d.product.title + ' | Nitro' : 'Product | Nitro', description: d?.product?.description});

export async function loader({params, context, request}: Route.LoaderArgs) {
  const ctx = await getContext(context, request);
  const product = await ctx.storefront.getProduct(params.handle);
  if (!product) throw data('Product not found', {status: 404});
  return {product};
}

export default function ProductPage() {
  const {product} = useLoaderData<typeof loader>();
  const first = product.variants.nodes[0];
  const {selectedVariant} = useOptimisticVariant(product, first);
  const variant = selectedVariant ?? first;

  return (
    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'2rem',alignItems:'start'}}>
      <Image data={variant?.image ?? product.featuredImage} alt={product.title} />
      <div>
        <h1>{product.title}</h1>
        {variant && <div style={{fontSize:'1.25rem',margin:'0.5rem 0'}}><ProductPrice price={variant.price} compareAtPrice={variant.compareAtPrice} /></div>}
        <VariantSelector product={product}>
          {(options) => options.map(({name, values}) => (
            <div key={name} style={{margin:'1rem 0'}}>
              <strong>{name}</strong>
              <div style={{display:'flex',gap:'0.5rem',marginTop:'0.5rem'}}>
                {values.map((o) => (
                  <Link key={o.value} to={o.to} replace preventScrollReset prefetch="intent"
                    style={{padding:'0.5rem 1rem',border:o.isActive?'2px solid #000':'1px solid #ccc',borderRadius:4,textDecoration:'none',color:'inherit',opacity:o.available?1:0.4}}>
                    {o.value}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </VariantSelector>
        {variant && <AddToCartButton merchandiseId={variant.id} disabled={!variant.availableForSale}>{variant.availableForSale ? 'Add to Cart' : 'Sold Out'}</AddToCartButton>}
        <RichText data={product.descriptionHtml} />
      </div>
    </div>
  );
}
`;

const ROUTE_COLLECTIONS_INDEX = `import {useLoaderData, Link} from 'react-router';
import type {Route} from './+types/collections._index';
import {getContext} from '~/lib/context';
import {getSeoMeta} from '@cloudcart/nitro';
import {Image} from '@cloudcart/nitro-react';

export const meta: Route.MetaFunction = () => getSeoMeta({title: 'Nitro | Collections'});

export async function loader({context, request}: Route.LoaderArgs) {
  const ctx = await getContext(context, request);
  const collections = await ctx.storefront.getCollections();
  return {collections};
}

export default function CollectionsIndex() {
  const {collections} = useLoaderData<typeof loader>();
  return (
    <div>
      <h1>Collections</h1>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(300px,1fr))',gap:'1.5rem'}}>
        {collections.map((c) => (
          <Link key={c.id} to={\`/collections/\${c.handle}\`} style={{textDecoration:'none',color:'inherit'}}>
            <Image data={c.image} alt={c.title} />
            <h3>{c.title}</h3>
          </Link>
        ))}
      </div>
    </div>
  );
}
`;

const ROUTE_COLLECTION = `import {useLoaderData, data, Link} from 'react-router';
import type {Route} from './+types/collections.$handle';
import {getContext} from '~/lib/context';
import {getSeoMeta} from '@cloudcart/nitro';
import {Money, Image} from '@cloudcart/nitro-react';

export const meta: Route.MetaFunction = ({data: d}) => getSeoMeta({title: d?.collection ? d.collection.title + ' | Nitro' : 'Collection | Nitro'});

export async function loader({params, context, request}: Route.LoaderArgs) {
  const ctx = await getContext(context, request);
  const collection = await ctx.storefront.getCollection(params.handle);
  if (!collection) throw data('Collection not found', {status: 404});
  return {collection};
}

export default function CollectionPage() {
  const {collection} = useLoaderData<typeof loader>();
  return (
    <div>
      <h1>{collection.title}</h1>
      <p>{collection.description}</p>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(250px,1fr))',gap:'1.5rem',marginTop:'1rem'}}>
        {collection.products?.nodes.map((p) => (
          <Link key={p.id} to={\`/products/\${p.handle}\`} style={{textDecoration:'none',color:'inherit'}}>
            <Image data={p.featuredImage} alt={p.title} />
            <h3>{p.title}</h3>
            <Money data={p.priceRange.minVariantPrice} />
          </Link>
        ))}
      </div>
    </div>
  );
}
`;

const ROUTE_CART = `import {useLoaderData, redirect} from 'react-router';
import type {Route} from './+types/cart';
import {getContext} from '~/lib/context';
import type {CartData} from '@cloudcart/nitro';
import {Money, Image, CartForm, useOptimisticCart} from '@cloudcart/nitro-react';

export const meta: Route.MetaFunction = () => [{title: 'Nitro | Cart'}];

export async function loader({context, request}: Route.LoaderArgs) {
  const ctx = await getContext(context, request);
  const cart = await ctx.cart.get();
  return {cart};
}

export async function action({request, context}: Route.ActionArgs) {
  const ctx = await getContext(context, request);
  const fd = await request.formData();
  const act = String(fd.get('action'));
  let cart: CartData;
  switch (act) {
    case 'ADD_TO_CART': cart = await ctx.cart.addLines([{merchandiseId: String(fd.get('merchandiseId')), quantity: Number(fd.get('quantity') || 1)}]); break;
    case 'UPDATE_CART': cart = await ctx.cart.updateLines([{id: String(fd.get('lineId')), quantity: Number(fd.get('quantity'))}]); break;
    case 'REMOVE_FROM_CART': cart = await ctx.cart.removeLines([String(fd.get('lineId'))]); break;
    default: cart = await ctx.cart.get();
  }
  if (fd.get('redirectTo')) return redirect(String(fd.get('redirectTo')), 303);
  return {cart};
}

export default function CartPage() {
  const {cart: loaderCart} = useLoaderData<typeof loader>();
  const cart = useOptimisticCart(loaderCart);
  if (cart.totalQuantity === 0) return <div><h1>Cart</h1><p>Your cart is empty.</p></div>;
  return (
    <div>
      <h1>Cart</h1>
      <ul style={{listStyle:'none',padding:0}}>
        {cart.lines.nodes.map((line) => (
          <li key={line.id} style={{display:'flex',gap:'1rem',padding:'1rem 0',borderBottom:'1px solid #eee',alignItems:'center'}}>
            <Image data={line.merchandise.image} alt={line.merchandise.title} width={80} height={80} />
            <div style={{flex:1}}>
              <strong>{line.merchandise.product.title}</strong>
              <div><Money data={line.cost.totalAmount} /></div>
            </div>
            <div style={{display:'flex',alignItems:'center',gap:'0.5rem'}}>
              <CartForm action="UPDATE_CART" inputs={{lineId: line.id, quantity: Math.max(0, line.quantity - 1)}}><button type="submit">-</button></CartForm>
              <span>{line.quantity}</span>
              <CartForm action="UPDATE_CART" inputs={{lineId: line.id, quantity: line.quantity + 1}}><button type="submit">+</button></CartForm>
              <CartForm action="REMOVE_FROM_CART" inputs={{lineId: line.id}}><button type="submit">x</button></CartForm>
            </div>
          </li>
        ))}
      </ul>
      <div style={{textAlign:'right',padding:'1rem 0',fontSize:'1.25rem'}}><strong>Total: <Money data={cart.cost.totalAmount} /></strong></div>
    </div>
  );
}
`;

const ROUTE_SEARCH = `import {useLoaderData, Form, Link} from 'react-router';
import type {Route} from './+types/search';
import {getContext} from '~/lib/context';
import {getSeoMeta} from '@cloudcart/nitro';
import {Money, Image} from '@cloudcart/nitro-react';

export const meta: Route.MetaFunction = () => getSeoMeta({title: 'Nitro | Search'});

export async function loader({request, context}: Route.LoaderArgs) {
  const ctx = await getContext(context, request);
  const q = new URL(request.url).searchParams.get('q') ?? '';
  const results = q ? await ctx.storefront.searchProducts(q) : [];
  return {query: q, results};
}

export default function SearchPage() {
  const {query, results} = useLoaderData<typeof loader>();
  return (
    <div>
      <h1>Search</h1>
      <Form method="get" style={{display:'flex',gap:'0.5rem',marginBottom:'2rem'}}>
        <input type="search" name="q" defaultValue={query} placeholder="Search products..." style={{flex:1,padding:'0.75rem',border:'1px solid #ccc',borderRadius:4}} />
        <button type="submit" style={{padding:'0.75rem 1.5rem'}}>Search</button>
      </Form>
      {query && <p>{results.length} result{results.length !== 1 ? 's' : ''} for "{query}"</p>}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(250px,1fr))',gap:'1.5rem'}}>
        {results.map((p) => (
          <Link key={p.id} to={\`/products/\${p.handle}\`} style={{textDecoration:'none',color:'inherit'}}>
            <Image data={p.featuredImage} alt={p.title} />
            <h3>{p.title}</h3>
            <Money data={p.priceRange.minVariantPrice} />
          </Link>
        ))}
      </div>
    </div>
  );
}
`;

const ROUTE_PAGE = `import {useLoaderData, data} from 'react-router';
import type {Route} from './+types/pages.$handle';
import {getContext} from '~/lib/context';
import {getSeoMeta} from '@cloudcart/nitro';
import {RichText} from '@cloudcart/nitro-react';

export const meta: Route.MetaFunction = ({data: d}) => getSeoMeta({title: d?.page ? d.page.title + ' | Nitro' : 'Page | Nitro'});

export async function loader({params, context, request}: Route.LoaderArgs) {
  const ctx = await getContext(context, request);
  const page = await ctx.storefront.getPage(params.handle);
  if (!page) throw data('Page not found', {status: 404});
  return {page};
}

export default function PageRoute() {
  const {page} = useLoaderData<typeof loader>();
  return <div><h1>{page.title}</h1><RichText data={page.body} /></div>;
}
`;

const ROUTE_BLOGS_INDEX = `import {useLoaderData, Link} from 'react-router';
import type {Route} from './+types/blogs._index';
import {getContext} from '~/lib/context';
import {getSeoMeta} from '@cloudcart/nitro';

export const meta: Route.MetaFunction = () => getSeoMeta({title: 'Nitro | Blog'});

export async function loader({context, request}: Route.LoaderArgs) {
  const ctx = await getContext(context, request);
  const blogs = await ctx.storefront.getBlogs();
  return {blogs};
}

export default function BlogsIndex() {
  const {blogs} = useLoaderData<typeof loader>();
  return <div><h1>Blog</h1>{blogs.map((b) => <Link key={b.id} to={\`/blogs/\${b.handle}\`} style={{display:'block',margin:'0.5rem 0'}}>{b.title}</Link>)}</div>;
}
`;

const ROUTE_BLOG = `import {useLoaderData, Link, data} from 'react-router';
import type {Route} from './+types/blogs.$blogHandle._index';
import {getContext} from '~/lib/context';
import {getSeoMeta} from '@cloudcart/nitro';
import {Image} from '@cloudcart/nitro-react';

export const meta: Route.MetaFunction = ({data: d}) => getSeoMeta({title: d?.blog ? d.blog.title + ' | Nitro' : 'Blog | Nitro'});

export async function loader({params, context, request}: Route.LoaderArgs) {
  const ctx = await getContext(context, request);
  const blog = await ctx.storefront.getBlog(params.blogHandle);
  if (!blog) throw data('Blog not found', {status: 404});
  const articles = await ctx.storefront.getArticles(params.blogHandle);
  return {blog, articles};
}

export default function BlogPage() {
  const {blog, articles} = useLoaderData<typeof loader>();
  return (
    <div>
      <h1>{blog.title}</h1>
      {articles.map((a) => (
        <Link key={a.id} to={\`/blogs/\${blog.handle}/\${a.handle}\`} style={{display:'block',margin:'1rem 0',textDecoration:'none',color:'inherit'}}>
          <Image data={a.image} alt={a.title} />
          <h3>{a.title}</h3>
          <p>{a.excerpt}</p>
        </Link>
      ))}
    </div>
  );
}
`;

const ROUTE_ARTICLE = `import {useLoaderData, data} from 'react-router';
import type {Route} from './+types/blogs.$blogHandle.$articleHandle';
import {getContext} from '~/lib/context';
import {getSeoMeta} from '@cloudcart/nitro';
import {Image, RichText} from '@cloudcart/nitro-react';

export const meta: Route.MetaFunction = ({data: d}) => getSeoMeta({title: d?.article ? d.article.title + ' | Nitro' : 'Article | Nitro'});

export async function loader({params, context, request}: Route.LoaderArgs) {
  const ctx = await getContext(context, request);
  const article = await ctx.storefront.getArticle(params.blogHandle, params.articleHandle);
  if (!article) throw data('Article not found', {status: 404});
  return {article};
}

export default function ArticlePage() {
  const {article} = useLoaderData<typeof loader>();
  return (
    <div>
      <h1>{article.title}</h1>
      <p>By {article.author.name} · {new Date(article.publishedAt).toLocaleDateString()}</p>
      {article.image && <Image data={article.image} alt={article.title} />}
      <RichText data={article.contentHtml} />
    </div>
  );
}
`;

const ROUTE_POLICIES_INDEX = `import {useLoaderData, Link} from 'react-router';
import type {Route} from './+types/policies._index';
import {getContext} from '~/lib/context';
import {getSeoMeta} from '@cloudcart/nitro';

export const meta: Route.MetaFunction = () => getSeoMeta({title: 'Nitro | Policies'});

export async function loader({context, request}: Route.LoaderArgs) {
  const ctx = await getContext(context, request);
  const policies = await ctx.storefront.getPolicies();
  return {policies};
}

export default function PoliciesIndex() {
  const {policies} = useLoaderData<typeof loader>();
  return <div><h1>Policies</h1><ul>{policies.map((p) => <li key={p.id}><Link to={\`/policies/\${p.handle}\`}>{p.title}</Link></li>)}</ul></div>;
}
`;

const ROUTE_POLICY = `import {useLoaderData, data} from 'react-router';
import type {Route} from './+types/policies.$handle';
import {getContext} from '~/lib/context';
import {getSeoMeta} from '@cloudcart/nitro';
import {RichText} from '@cloudcart/nitro-react';

export const meta: Route.MetaFunction = ({data: d}) => getSeoMeta({title: d?.policy ? d.policy.title + ' | Nitro' : 'Policy | Nitro'});

export async function loader({params, context, request}: Route.LoaderArgs) {
  const ctx = await getContext(context, request);
  const policy = await ctx.storefront.getPolicy(params.handle);
  if (!policy) throw data('Policy not found', {status: 404});
  return {policy};
}

export default function PolicyPage() {
  const {policy} = useLoaderData<typeof loader>();
  return <div><h1>{policy.title}</h1><RichText data={policy.body} /></div>;
}
`;

const ROUTE_DISCOUNT = `import {redirect} from 'react-router';
import type {Route} from './+types/discount.$code';
import {getContext} from '~/lib/context';

export async function loader({params, context, request}: Route.LoaderArgs) {
  const ctx = await getContext(context, request);
  if (params.code) await ctx.cart.updateDiscountCodes([params.code]);
  return redirect('/cart');
}
`;

const ROUTE_ROBOTS = `import {generateRobots} from '@cloudcart/nitro';

export function loader() {
  return new Response(generateRobots({
    rules: [{userAgent: '*', allow: ['/'], disallow: ['/admin', '/cart', '/account']}],
    sitemap: 'https://localhost/sitemap.xml',
  }), {headers: {'Content-Type': 'text/plain', 'Cache-Control': 'public, max-age=86400'}});
}
`;

const ROUTE_SITEMAP = `import type {Route} from './+types/[sitemap.xml]';
import {getContext} from '~/lib/context';
import {generateSitemap} from '@cloudcart/nitro';

export async function loader({context, request}: Route.LoaderArgs) {
  const ctx = await getContext(context, request);
  const origin = new URL(request.url).origin;
  const [products, collections] = await Promise.all([ctx.storefront.getProducts(100), ctx.storefront.getCollections(100)]);
  const entries = [
    {url: origin, changefreq: 'daily' as const, priority: 1.0},
    ...collections.map((c) => ({url: origin + '/collections/' + c.handle, changefreq: 'weekly' as const, priority: 0.7})),
    ...products.map((p) => ({url: origin + '/products/' + p.handle, changefreq: 'weekly' as const, priority: 0.6})),
  ];
  return new Response(generateSitemap(entries), {headers: {'Content-Type': 'application/xml', 'Cache-Control': 'public, max-age=86400'}});
}
`;

const ROUTE_CATCHALL = `import {data} from 'react-router';

export async function loader() {
  throw data('Not Found', {status: 404});
}

export default function CatchAll() { return null; }
`;
