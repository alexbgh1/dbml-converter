import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
/*
 This script just injects Google Analytics
 and Google site verification tags into the generated index.html file.
 (github actions building stage)
*/
const DEFAULT_INDEX_PATH = "dist/dbml-converter/browser/index.html";
const OFFICIAL_REPOSITORY = "alexbgh1/dbml-converter";
const OFFICIAL_ORIGIN = "https://alexbgh1.github.io";
const OFFICIAL_BASE_PATH = "/dbml-converter";

const MANAGED_BLOCK_PATTERN =
  /([ \t]*)<!-- deployment-tags:start -->[\s\S]*?^[ \t]*<!-- deployment-tags:end -->/m;
const LEGACY_GOOGLE_TAG_PATTERN =
  /google-site-verification|googletagmanager\.com\/gtag\/js/i;
const VERIFICATION_TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/;
const ANALYTICS_ID_PATTERN = /^G-[A-Z0-9]+$/;

function indentBlock(block, indentation) {
  return block
    .split("\n")
    .map((line) => `${indentation}${line}`)
    .join("\n");
}

function validateOptionalValue(value, pattern, name) {
  const normalizedValue = value.trim();

  if (normalizedValue && !pattern.test(normalizedValue)) {
    throw new Error(`Invalid ${name}: "${normalizedValue}".`);
  }

  return normalizedValue;
}

function validateDeploymentOrigin(value) {
  const normalizedValue = value.trim();
  let url;

  try {
    url = new URL(normalizedValue);
  } catch {
    throw new Error(`Invalid deployment origin: "${normalizedValue}".`);
  }

  if (
    url.protocol !== "https:" ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(`Invalid deployment origin: "${normalizedValue}".`);
  }

  return url.origin;
}

function validateDeploymentBasePath(value) {
  const normalizedValue = value.trim();

  if (!normalizedValue || normalizedValue === "/") {
    return "";
  }

  if (!/^\/[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*$/.test(normalizedValue)) {
    throw new Error(`Invalid deployment base path: "${normalizedValue}".`);
  }

  return normalizedValue;
}

function createAnalyticsScript(
  measurementId,
  deploymentOrigin,
  deploymentBasePath,
) {
  return `<script>
  (() => {
    const measurementId = ${JSON.stringify(measurementId)};
    const expectedOrigin = ${JSON.stringify(deploymentOrigin)};
    const expectedBasePath = ${JSON.stringify(deploymentBasePath)};
    const { origin, pathname } = window.location;
    const isOfficialDeployment =
      origin === expectedOrigin &&
      (!expectedBasePath ||
        pathname === expectedBasePath ||
        pathname.startsWith(expectedBasePath + "/"));

    if (!isOfficialDeployment) {
      return;
    }

    window.dataLayer = window.dataLayer || [];
    window.gtag = function gtag() {
      window.dataLayer.push(arguments);
    };
    window.gtag("js", new Date());
    window.gtag("config", measurementId);

    const script = document.createElement("script");
    script.async = true;
    script.src =
      "https://www.googletagmanager.com/gtag/js?id=" +
      encodeURIComponent(measurementId);
    document.head.appendChild(script);
  })();
</script>`;
}

export function getDeploymentTagConfig(environment = process.env) {
  const repository = environment.GITHUB_REPOSITORY?.trim() ?? "";

  if (repository && repository !== OFFICIAL_REPOSITORY) {
    return {
      googleAnalyticsId: "",
      googleSiteVerification: "",
      skippedRepository: repository,
    };
  }

  return {
    deploymentBasePath: environment.DEPLOYMENT_BASE_PATH ?? OFFICIAL_BASE_PATH,
    deploymentOrigin: environment.DEPLOYMENT_ORIGIN ?? OFFICIAL_ORIGIN,
    googleAnalyticsId: environment.GOOGLE_ANALYTICS_ID ?? "",
    googleSiteVerification: environment.GOOGLE_SITE_VERIFICATION ?? "",
    skippedRepository: "",
  };
}

export function injectGoogleTags(
  html,
  {
    deploymentBasePath = OFFICIAL_BASE_PATH,
    deploymentOrigin = OFFICIAL_ORIGIN,
    googleAnalyticsId = "",
    googleSiteVerification = "",
  } = {},
) {
  const managedBlock = html.match(MANAGED_BLOCK_PATTERN);

  if (!managedBlock) {
    throw new Error(
      "The deployment tag markers were not found in the generated index.html.",
    );
  }

  const htmlOutsideManagedBlock = html.replace(MANAGED_BLOCK_PATTERN, "");
  if (LEGACY_GOOGLE_TAG_PATTERN.test(htmlOutsideManagedBlock)) {
    throw new Error(
      "Google tags exist outside the managed deployment tag block.",
    );
  }

  const verificationToken = validateOptionalValue(
    googleSiteVerification,
    VERIFICATION_TOKEN_PATTERN,
    "Google site verification token",
  );
  const measurementId = validateOptionalValue(
    googleAnalyticsId,
    ANALYTICS_ID_PATTERN,
    "Google Analytics measurement ID",
  );

  const blocks = [];
  if (verificationToken) {
    blocks.push(
      `<meta name="google-site-verification" content="${verificationToken}" />`,
    );
  }
  if (measurementId) {
    blocks.push(
      createAnalyticsScript(
        measurementId,
        validateDeploymentOrigin(deploymentOrigin),
        validateDeploymentBasePath(deploymentBasePath),
      ),
    );
  }

  const indentation = managedBlock[1];
  const renderedContent = blocks
    .map((block) => indentBlock(block, indentation))
    .join("\n\n");
  const replacement = [
    `${indentation}<!-- deployment-tags:start -->`,
    renderedContent,
    `${indentation}<!-- deployment-tags:end -->`,
  ]
    .filter((line, index) => line || index !== 1)
    .join("\n");

  return html.replace(MANAGED_BLOCK_PATTERN, replacement);
}

async function main() {
  const indexPath = resolve(process.argv[2] ?? DEFAULT_INDEX_PATH);
  const html = await readFile(indexPath, "utf8");
  const config = getDeploymentTagConfig();
  const updatedHtml = injectGoogleTags(html, config);

  if (updatedHtml !== html) {
    await writeFile(indexPath, updatedHtml, "utf8");
  }

  if (config.skippedRepository) {
    console.log(
      `Skipped Google tags for non-official repository "${config.skippedRepository}".`,
    );
    return;
  }

  const injectedTags = [
    config.googleSiteVerification && "site verification",
    config.googleAnalyticsId && "Google Analytics",
  ].filter(Boolean);

  console.log(
    injectedTags.length
      ? `Injected ${injectedTags.join(" and ")} into ${indexPath}.`
      : `No deployment tags configured; ${indexPath} remains tracking-free.`,
  );
}

const isDirectExecution =
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isDirectExecution) {
  await main();
}
