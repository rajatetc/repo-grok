import type { TechStack, RepoFile } from "../types/index.js";

// dep name → human-readable label
const FRAMEWORKS: [string, string][] = [
  ["@angular/core",      "Angular"],
  ["@sveltejs/kit",      "SvelteKit"],
  ["svelte",             "Svelte"],
  ["nuxt",               "Nuxt"],
  ["next",               "Next.js"],
  ["gatsby",             "Gatsby"],
  ["@remix-run/react",   "Remix"],
  ["astro",              "Astro"],
  ["solid-js",           "Solid.js"],
  ["qwik",               "Qwik"],
  ["react",              "React"],
  ["vue",                "Vue"],
];

const STATE: [string, string][] = [
  ["@reduxjs/toolkit",   "Redux Toolkit"],
  ["redux",              "Redux"],
  ["react-redux",        "Redux"],
  ["zustand",            "Zustand"],
  ["jotai",              "Jotai"],
  ["recoil",             "Recoil"],
  ["mobx",               "MobX"],
  ["xstate",             "XState"],
  ["@tanstack/react-query", "TanStack Query"],
  ["react-query",        "TanStack Query"],
  ["swr",                "SWR"],
  ["pinia",              "Pinia"],
  ["vuex",               "Vuex"],
];

const STYLING: [string, string][] = [
  ["tailwindcss",        "Tailwind CSS"],
  ["styled-components",  "Styled Components"],
  ["@emotion/react",     "Emotion"],
  ["@emotion/styled",    "Emotion"],
  ["@mui/material",      "Material UI"],
  ["@chakra-ui/react",   "Chakra UI"],
  ["antd",               "Ant Design"],
  ["@mantine/core",      "Mantine"],
  ["bootstrap",          "Bootstrap"],
  ["@radix-ui/react-dialog", "Radix UI"],
  ["sass",               "Sass"],
  ["less",               "Less"],
];

const TESTING: [string, string][] = [
  ["vitest",             "Vitest"],
  ["jest",               "Jest"],
  ["@playwright/test",   "Playwright"],
  ["playwright",         "Playwright"],
  ["cypress",            "Cypress"],
  ["@testing-library/react", "React Testing Library"],
  ["@testing-library/vue",   "Vue Testing Library"],
  ["mocha",              "Mocha"],
  ["jasmine",            "Jasmine"],
  ["@storybook/react",   "Storybook"],
  ["storybook",          "Storybook"],
];

const BUILD_TOOLS: [string, string][] = [
  ["turbopack",          "Turbopack"],
  ["vite",               "Vite"],
  ["esbuild",            "esbuild"],
  ["tsup",               "tsup"],
  ["rollup",             "Rollup"],
  ["parcel",             "Parcel"],
  ["webpack",            "Webpack"],
  ["@swc/core",          "SWC"],
];

const BACKEND: [string, string][] = [
  ["@nestjs/core",       "NestJS"],
  ["fastify",            "Fastify"],
  ["express",            "Express"],
  ["koa",                "Koa"],
  ["hono",               "Hono"],
  ["@hapi/hapi",         "Hapi"],
  ["drizzle-orm",        "Drizzle"],
  ["prisma",             "Prisma"],
  ["@prisma/client",     "Prisma"],
  ["typeorm",            "TypeORM"],
  ["mongoose",           "Mongoose"],
  ["sequelize",          "Sequelize"],
  ["@apollo/server",     "Apollo Server"],
  ["apollo-server",      "Apollo Server"],
  ["@trpc/server",       "tRPC"],
  ["graphql",            "GraphQL"],
  ["socket.io",          "Socket.io"],
  ["pg",                 "PostgreSQL"],
  ["mysql2",             "MySQL"],
  ["ioredis",            "Redis"],
  ["redis",              "Redis"],
  ["@supabase/supabase-js", "Supabase"],
  ["firebase",           "Firebase"],
];

const OTHER: [string, string][] = [
  ["openai",             "OpenAI"],
  ["@anthropic-ai/sdk",  "Anthropic"],
  ["@google/generative-ai", "Google AI"],
  ["stripe",             "Stripe"],
  ["zod",                "Zod"],
  ["yup",                "Yup"],
  ["react-hook-form",    "React Hook Form"],
  ["formik",             "Formik"],
  ["framer-motion",      "Framer Motion"],
  ["@tanstack/router",   "TanStack Router"],
  ["axios",              "Axios"],
];

// Config file name → [category, label] for signals not in package.json
const CONFIG_SIGNALS: [string, keyof TechStack, string][] = [
  ["tailwind.config",    "styling",   "Tailwind CSS"],
  ["next.config",        "framework", "Next.js"],
  ["vite.config",        "buildTool", "Vite"],
  ["webpack.config",     "buildTool", "Webpack"],
  ["jest.config",        "testing",   "Jest"],
  ["vitest.config",      "testing",   "Vitest"],
  ["schema.prisma",      "backend",   "Prisma"],
];

function firstMatch(deps: Set<string>, candidates: [string, string][]): string | undefined {
  for (const [pkg, label] of candidates) {
    if (deps.has(pkg)) return label;
  }
}

function allMatches(deps: Set<string>, candidates: [string, string][]): string[] {
  const seen = new Set<string>();
  const results: string[] = [];
  for (const [pkg, label] of candidates) {
    if (deps.has(pkg) && !seen.has(label)) {
      seen.add(label);
      results.push(label);
    }
  }
  return results;
}

export function detectTechStack(files: RepoFile[]): TechStack {
  const pkgFile =
    files.find((f) => f.path === "package.json") ??
    files.find((f) => f.path.endsWith("/package.json"));

  let deps = new Set<string>();
  if (pkgFile) {
    try {
      const pkg = JSON.parse(pkgFile.content) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        peerDependencies?: Record<string, string>;
      };
      deps = new Set([
        ...Object.keys(pkg.dependencies ?? {}),
        ...Object.keys(pkg.devDependencies ?? {}),
        ...Object.keys(pkg.peerDependencies ?? {}),
      ]);
    } catch {
      // malformed package.json — proceed with empty deps
    }
  }

  const filePaths = files.map((f) => f.path);

  const stack: TechStack = {};

  const framework = firstMatch(deps, FRAMEWORKS);
  if (framework) stack.framework = framework;

  const state = allMatches(deps, STATE);
  if (state.length) stack.stateManagement = state;

  let styling = allMatches(deps, STYLING);
  const testing = allMatches(deps, TESTING);
  let buildTool = firstMatch(deps, BUILD_TOOLS);
  const backend = allMatches(deps, BACKEND);
  const other = allMatches(deps, OTHER);

  // Augment with config file signals for things not captured by deps.
  // Only match root-level or one-level-deep config files — a next.config.js
  // buried inside packages/foo/ shouldn't define the project's framework.
  for (const [configName, category, label] of CONFIG_SIGNALS) {
    const found = filePaths.some((p) => {
      const depth = (p.match(/\//g) ?? []).length;
      return depth <= 1 && p.includes(configName);
    });
    if (!found) continue;

    if (category === "framework" && !stack.framework) {
      stack.framework = label;
    } else if (category === "buildTool" && !buildTool) {
      buildTool = label;
    } else if (category === "styling" && !styling.includes(label)) {
      styling = [label, ...styling];
    } else if (category === "testing" && !testing.includes(label)) {
      testing.push(label);
    } else if (category === "backend" && !backend.includes(label)) {
      backend.push(label);
    }
  }

  if (styling.length)  stack.styling  = styling;
  if (testing.length)  stack.testing   = testing;
  if (buildTool)       stack.buildTool = buildTool;
  if (backend.length)  stack.backend   = backend;
  if (other.length)    stack.other     = other;

  return stack;
}
