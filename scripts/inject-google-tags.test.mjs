import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getDeploymentTagConfig,
  injectGoogleTags,
} from './inject-google-tags.mjs';

const htmlTemplate = `<!doctype html>
<html>
  <head>
    <!-- deployment-tags:start -->
    <!-- deployment-tags:end -->
  </head>
</html>`;

test('leaves the managed block empty when no values are configured', () => {
  const result = injectGoogleTags(htmlTemplate);

  assert.match(result, /deployment-tags:start -->\s+<!-- deployment-tags:end/);
  assert.doesNotMatch(result, /google-site-verification/);
  assert.doesNotMatch(result, /googletagmanager/);
});

test('injects verification and analytics with a production-only runtime guard', () => {
  const result = injectGoogleTags(htmlTemplate, {
    googleAnalyticsId: 'G-TEST123',
    googleSiteVerification: 'verification_token-123',
  });

  assert.match(
    result,
    /name="google-site-verification" content="verification_token-123"/,
  );
  assert.match(result, /const measurementId = "G-TEST123"/);
  assert.match(result, /https:\/\/alexbgh1\.github\.io/);
  assert.match(result, /const expectedBasePath = "\/dbml-converter"/);
  assert.match(result, /googletagmanager\.com\/gtag\/js/);
});

test('uses the deployment location provided by GitHub Pages', () => {
  const result = injectGoogleTags(htmlTemplate, {
    deploymentBasePath: '',
    deploymentOrigin: 'https://dbml.example.com',
    googleAnalyticsId: 'G-TEST123',
  });

  assert.match(result, /const expectedOrigin = "https:\/\/dbml\.example\.com"/);
  assert.match(result, /const expectedBasePath = ""/);
  assert.match(result, /!expectedBasePath/);
});

test('is idempotent', () => {
  const config = {
    googleAnalyticsId: 'G-TEST123',
    googleSiteVerification: 'verification_token-123',
  };
  const firstResult = injectGoogleTags(htmlTemplate, config);

  assert.equal(injectGoogleTags(firstResult, config), firstResult);
});

test('rejects malformed deployment values', () => {
  assert.throws(
    () =>
      injectGoogleTags(htmlTemplate, {
        googleAnalyticsId: 'UA-123',
      }),
    /Invalid Google Analytics measurement ID/,
  );
  assert.throws(
    () =>
      injectGoogleTags(htmlTemplate, {
        googleSiteVerification: '"><script>',
      }),
    /Invalid Google site verification token/,
  );
  assert.throws(
    () =>
      injectGoogleTags(htmlTemplate, {
        deploymentOrigin: 'https://example.com/unexpected-path',
        googleAnalyticsId: 'G-TEST123',
      }),
    /Invalid deployment origin/,
  );
  assert.throws(
    () =>
      injectGoogleTags(htmlTemplate, {
        deploymentBasePath: '../unexpected-path',
        googleAnalyticsId: 'G-TEST123',
      }),
    /Invalid deployment base path/,
  );
});

test('rejects Google tags outside the managed block', () => {
  const htmlWithLegacyTag = htmlTemplate.replace(
    '</head>',
    '<script src="https://www.googletagmanager.com/gtag/js"></script></head>',
  );

  assert.throws(
    () => injectGoogleTags(htmlWithLegacyTag),
    /outside the managed deployment tag block/,
  );
});

test('ignores values when GitHub Actions runs from a fork', () => {
  const config = getDeploymentTagConfig({
    GITHUB_REPOSITORY: 'someone/dbml-converter',
    GOOGLE_ANALYTICS_ID: 'G-TEST123',
    GOOGLE_SITE_VERIFICATION: 'verification_token-123',
  });

  assert.equal(config.googleAnalyticsId, '');
  assert.equal(config.googleSiteVerification, '');
  assert.equal(config.skippedRepository, 'someone/dbml-converter');
});

test('accepts repository variables for the official repository', () => {
  const config = getDeploymentTagConfig({
    GITHUB_REPOSITORY: 'alexbgh1/dbml-converter',
    GOOGLE_ANALYTICS_ID: 'G-TEST123',
    GOOGLE_SITE_VERIFICATION: 'verification_token-123',
  });

  assert.equal(config.googleAnalyticsId, 'G-TEST123');
  assert.equal(config.googleSiteVerification, 'verification_token-123');
  assert.equal(config.deploymentOrigin, 'https://alexbgh1.github.io');
  assert.equal(config.deploymentBasePath, '/dbml-converter');
  assert.equal(config.skippedRepository, '');
});
