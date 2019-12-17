'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

function _interopDefault (ex) { return (ex && (typeof ex === 'object') && 'default' in ex) ? ex['default'] : ex; }

var md5 = _interopDefault(require('md5'));
var queryString = _interopDefault(require('query-string'));
var yup = require('yup');

const IS_BROWSER = typeof window !== 'undefined';
const GLOBAL_STORE_KEY = '___PRISMIC___';

const isFunction = x => !!(x && x.constructor && x.call && x.apply); // See: lodash.pick

const omit = fields => obj => Object.keys(obj).reduce((acc, key) => {
  if (!fields.includes(key)) acc[key] = obj[key];
  return acc;
}, {}); // Maps an object to a new object with key-value pairs. Mapping function must

const baseValidations = {
  repositoryName: yup.string().strict().required(),
  accessToken: yup.string().strict().required(),
  linkResolver: yup.mixed().test('is function', '${path} is not a function', isFunction).default(() => () => () => {}),
  fetchLinks: yup.array().of(yup.string().strict().required()).default([]),
  htmlSerializer: yup.mixed().test('is function', '${path} is not a function', isFunction).default(() => () => () => {}),
  schemas: yup.object().strict().required(),
  lang: yup.string().default('*'),
  shouldNormalizeImage: yup.mixed().test('is function', '${path} is not a function', isFunction).default(() => () => true),
  plugins: yup.array().max(0).default([]),
  // Default value set in validatePluginOptions below.
  typePathsFilenamePrefix: yup.string().default("prismic-typepaths---"),
  // Browser-only validations
  pathResolver: yup.mixed().test('is function', '${path} is not a function', x => typeof x === 'undefined' || isFunction(x)),
  schemasDigest: yup.string().strict().required(),
  ref: yup.string().strict()
};
const validatePluginOptions = (pluginOptions, filterValidations = {}) => {
  // Must do this here with access to pluginOptions.
  if (pluginOptions.repositoryName) baseValidations.typePathsFilenamePrefix = baseValidations.typePathsFilenamePrefix.default("prismic-typepaths---".concat(pluginOptions.repositoryName && pluginOptions.repositoryName.toString(), "-")); // Filter validations based on the filterValidations param.

  const filteredValidations = Object.keys(baseValidations).reduce((acc, key) => {
    if (filterValidations[key] || !filterValidations.hasOwnProperty(key)) acc[key] = baseValidations[key];
    return acc;
  }, {});
  const schema = yup.object().shape(filteredValidations);
  return schema.validateSync(pluginOptions, {
    abortEarly: false
  });
};

const onClientEntry = async (_, rawPluginOptions) => {
  if (!IS_BROWSER) return;
  const searchParams = queryString.parse(window.location.search);
  const isPreviewSession = searchParams.token && searchParams.documentId;

  if (isPreviewSession) {
    const pluginOptions = validatePluginOptions(omit(['schemas', 'plugins'])(rawPluginOptions), {
      schemas: false,
      schemasDigest: false
    });
    const schemasDigest = md5(JSON.stringify(rawPluginOptions.schemas));
    window[GLOBAL_STORE_KEY] = window[GLOBAL_STORE_KEY] || {};
    Object.assign(window[GLOBAL_STORE_KEY], {
      [rawPluginOptions.repositoryName]: {
        pluginOptions,
        schemasDigest
      }
    });
  }
};

exports.onClientEntry = onClientEntry;
//# sourceMappingURL=gatsby-browser.js.map
