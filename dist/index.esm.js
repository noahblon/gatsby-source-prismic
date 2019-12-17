import { useState, useCallback, useEffect } from 'react';
import { set } from 'es-cookie';
import Prismic from 'prismic-javascript';
import queryString from 'query-string';
import { string, mixed, array, object } from 'yup';
import uuidv5 from 'uuid/v5';
import md5 from 'md5';
import traverse from 'traverse';
import camelCase from 'camelcase';
import mergeWith from 'lodash.mergewith';
import cloneDeep from 'lodash.clonedeep';
import PrismicDOM from 'prismic-dom';
import pascalcase from 'pascalcase';
import compose from 'compose-tiny';

function _defineProperty(obj, key, value) {
  if (key in obj) {
    Object.defineProperty(obj, key, {
      value: value,
      enumerable: true,
      configurable: true,
      writable: true
    });
  } else {
    obj[key] = value;
  }

  return obj;
}

function ownKeys(object, enumerableOnly) {
  var keys = Object.keys(object);

  if (Object.getOwnPropertySymbols) {
    var symbols = Object.getOwnPropertySymbols(object);
    if (enumerableOnly) symbols = symbols.filter(function (sym) {
      return Object.getOwnPropertyDescriptor(object, sym).enumerable;
    });
    keys.push.apply(keys, symbols);
  }

  return keys;
}

function _objectSpread2(target) {
  for (var i = 1; i < arguments.length; i++) {
    var source = arguments[i] != null ? arguments[i] : {};

    if (i % 2) {
      ownKeys(Object(source), true).forEach(function (key) {
        _defineProperty(target, key, source[key]);
      });
    } else if (Object.getOwnPropertyDescriptors) {
      Object.defineProperties(target, Object.getOwnPropertyDescriptors(source));
    } else {
      ownKeys(Object(source)).forEach(function (key) {
        Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(source, key));
      });
    }
  }

  return target;
}

const isFunction = x => !!(x && x.constructor && x.call && x.apply); // See: lodash.pick

const pick = fields => obj => Object.keys(obj).reduce((acc, key) => {
  if (fields.includes(key)) acc[key] = obj[key];
  return acc;
}, {}); // See: lodash.omit

const omit = fields => obj => Object.keys(obj).reduce((acc, key) => {
  if (!fields.includes(key)) acc[key] = obj[key];
  return acc;
}, {}); // Maps an object to a new object with key-value pairs. Mapping function must
// return a key-value tuple.

const mapObj = fn => async obj => {
  const entries = Object.entries(obj);
  const pairs = await Promise.all(entries.map(x => Promise.resolve(fn(x))));
  const result = {};

  for (let i = 0; i < pairs.length; i++) {
    const [k, v] = pairs[i];
    result[k] = v;
  }

  return result;
};

const baseValidations = {
  repositoryName: string().strict().required(),
  accessToken: string().strict().required(),
  linkResolver: mixed().test('is function', '${path} is not a function', isFunction).default(() => () => () => {}),
  fetchLinks: array().of(string().strict().required()).default([]),
  htmlSerializer: mixed().test('is function', '${path} is not a function', isFunction).default(() => () => () => {}),
  schemas: object().strict().required(),
  lang: string().default('*'),
  shouldNormalizeImage: mixed().test('is function', '${path} is not a function', isFunction).default(() => () => true),
  plugins: array().max(0).default([]),
  // Default value set in validatePluginOptions below.
  typePathsFilenamePrefix: string().default("prismic-typepaths---"),
  // Browser-only validations
  pathResolver: mixed().test('is function', '${path} is not a function', x => typeof x === 'undefined' || isFunction(x)),
  schemasDigest: string().strict().required(),
  ref: string().strict()
};
const validatePluginOptions = (pluginOptions, filterValidations = {}) => {
  // Must do this here with access to pluginOptions.
  if (pluginOptions.repositoryName) baseValidations.typePathsFilenamePrefix = baseValidations.typePathsFilenamePrefix.default("prismic-typepaths---".concat(pluginOptions.repositoryName && pluginOptions.repositoryName.toString(), "-")); // Filter validations based on the filterValidations param.

  const filteredValidations = Object.keys(baseValidations).reduce((acc, key) => {
    if (filterValidations[key] || !filterValidations.hasOwnProperty(key)) acc[key] = baseValidations[key];
    return acc;
  }, {});
  const schema = object().shape(filteredValidations);
  return schema.validateSync(pluginOptions, {
    abortEarly: false
  });
};

const IS_BROWSER = typeof window !== 'undefined';
const GLOBAL_STORE_KEY = '___PRISMIC___';
const IMAGE_FIELD_KEYS = ['dimensions', 'alt', 'copyright', 'url', 'localFile'];

const getTypeForPath = (path, typePaths) => {
  const stringifiedPath = JSON.stringify(path);
  const def = typePaths.find(x => JSON.stringify(x.path) === stringifiedPath);
  if (!def) return;
  if (/^\[.*GroupType\]$/.test(def.type)) return 'Group';
  if (/^\[.*SlicesType\]$/.test(def.type)) return 'Slices';
  return def.type;
};

const normalizeField = async (id, value, depth, context) => {
  const {
    doc,
    typePaths,
    createNode,
    createNodeId,
    createContentDigest,
    normalizeImageField,
    normalizeLinkField,
    normalizeSlicesField,
    normalizeStructuredTextField
  } = context;
  const type = getTypeForPath([...depth, id], typePaths);

  switch (type) {
    case 'PrismicImageType':
      const base = await compose(baseValue => normalizeImageField(id, baseValue, depth, context), pick(IMAGE_FIELD_KEYS))(value); // Thumbnail image data are siblings of the base image data so we need to
      // smartly extract and normalize the key-value pairs.

      const thumbs = await compose(mapObj(async ([k, v]) => [k, await normalizeImageField(id, v, depth, context)]), omit(IMAGE_FIELD_KEYS))(value);
      return _objectSpread2({}, base, {}, thumbs);

    case 'PrismicStructuredTextType':
      return await normalizeStructuredTextField(id, value, depth, context);

    case 'PrismicLinkType':
      return await normalizeLinkField(id, value, depth, context);

    case 'Group':
      return await normalizeObjs(value, [...depth, id], context);

    case 'Slices':
      const sliceNodeIds = await Promise.all(value.map(async (v, idx) => {
        const sliceNodeId = createNodeId("".concat(doc.type, " ").concat(doc.id, " ").concat(id, " ").concat(idx));
        const normalizedPrimary = await normalizeObj(v.primary || {}, [...depth, id, v.slice_type, 'primary'], context);
        const normalizedItems = await normalizeObjs(v.items || [], [...depth, id, v.slice_type, 'items'], context);
        createNode(_objectSpread2({}, v, {
          id: sliceNodeId,
          primary: normalizedPrimary,
          items: normalizedItems,
          internal: {
            type: pascalcase("Prismic ".concat(doc.type, " ").concat(id, " ").concat(v.slice_type)),
            contentDigest: createContentDigest(v)
          }
        }));
        return sliceNodeId;
      }));
      return await normalizeSlicesField(id, sliceNodeIds, [...depth, id], context);

    default:
      return value;
  }
}; // Returns a promise that resolves after normalizing each property in an
// object.


const normalizeObj = async (obj = {}, depth, context) => await mapObj(async ([k, v]) => [k, await normalizeField(k, v, depth, context)])(obj); // Returns a promise that resolves after normalizing a list of objects.


const normalizeObjs = (objs = [], depth, context) => Promise.all(objs.map(obj => normalizeObj(obj, depth, context)));

const documentToNodes = async (doc, context) => {
  const {
    createNodeId,
    createContentDigest,
    createNode,
    pluginOptions
  } = context;
  const {
    linkResolver
  } = pluginOptions;
  const docNodeId = createNodeId("".concat(doc.type, " ").concat(doc.id));
  const normalizedData = await normalizeObj(doc.data, [doc.type, 'data'], _objectSpread2({}, context, {
    doc,
    docNodeId
  }));
  const linkResolverForDoc = linkResolver({
    node: doc
  });
  createNode(_objectSpread2({}, doc, {
    id: docNodeId,
    prismicId: doc.id,
    data: normalizedData,
    dataString: JSON.stringify(doc.data),
    dataRaw: doc.data,
    url: linkResolverForDoc(doc),
    internal: {
      type: pascalcase("Prismic ".concat(doc.type)),
      contentDigest: createContentDigest(doc)
    }
  }));
  return docNodeId;
};

// versions of the value using `prismic-dom` on the `html` and `text` keys,
// respectively. The raw value is provided on the `raw` key.

const normalizeStructuredTextField = async (id, value, _depth, context) => {
  const {
    doc,
    pluginOptions
  } = context;
  const {
    linkResolver,
    htmlSerializer
  } = pluginOptions;
  const linkResolverForField = linkResolver({
    key: id,
    value,
    node: doc
  });
  const htmlSerializerForField = htmlSerializer({
    key: id,
    value,
    node: doc
  });
  return {
    html: PrismicDOM.RichText.asHtml(value, linkResolverForField, htmlSerializerForField),
    text: PrismicDOM.RichText.asText(value),
    raw: value
  };
};

const fetchAndCreateDocumentNodes = async (value, context) => {
  const {
    createNode,
    createNodeId,
    hasNodeById,
    pluginOptions
  } = context;
  const {
    repositoryName,
    accessToken,
    fetchLinks
  } = pluginOptions;
  const linkedDocId = createNodeId("".concat(value.type, " ").concat(value.id));
  if (hasNodeById(linkedDocId)) return; // Create a key in our cache to prevent infinite recursion.

  createNode({
    id: linkedDocId
  }); // Query Prismic's API for the actual document node.

  const apiEndpoint = "https://".concat(repositoryName, ".cdn.prismic.io/api/v2");
  const api = await Prismic.api(apiEndpoint, {
    accessToken
  });
  const doc = await api.getByID(value.id, {
    fetchLinks
  }); // Normalize the document.

  await documentToNodes(doc, context);
};

const normalizeLinkField = async (id, value, _depth, context) => {
  const {
    doc,
    getNodeById,
    createNodeId,
    pluginOptions
  } = context;
  const {
    linkResolver
  } = pluginOptions;
  const linkResolverForField = linkResolver({
    key: id,
    value,
    node: doc
  });
  const linkedDocId = createNodeId("".concat(value.type, " ").concat(value.id)); // Fetches, normalizes, and caches linked document if not present in cache.

  if (value.link_type === 'Document' && value.id) await fetchAndCreateDocumentNodes(value, context);
  const proxyHandler = {
    get: (obj, prop) => {
      if (prop === 'document') {
        if (value.link_type === 'Document') return getNodeById(linkedDocId);
        return null;
      }

      return obj[prop];
    }
  };
  return new Proxy(_objectSpread2({}, value, {
    url: PrismicDOM.Link.url(value, linkResolverForField),
    raw: value,
    document: null // TODO: ???????

  }), proxyHandler);
};
const normalizeSlicesField = async (_id, value, _depth, context) => {
  const {
    hasNodeById,
    getNodeById
  } = context;
  return new Proxy(value, {
    get: (obj, prop) => {
      if (hasNodeById(obj[prop])) {
        const node = getNodeById(obj[prop]);
        return _objectSpread2({}, node, {
          __typename: node.internal.type
        });
      }

      return obj[prop];
    }
  });
};
const normalizeImageField = async (_id, value) => _objectSpread2({}, value, {
  localFile: null
});

const seedConstant = "638f7a53-c567-4eca-8fc1-b23efb1cfb2b";

const createNodeId = id => uuidv5(id, uuidv5('gatsby-source-prismic', seedConstant));

const createContentDigest = obj => md5(JSON.stringify(obj));

const nodeStore = new Map();

const createNode = node => nodeStore.set(node.id, node);

const hasNodeById = id => nodeStore.has(id);

const getNodeById = id => nodeStore.get(id);
/**
 * @typedef {Object} pluginOptions
 * @property {string} repositoryName - Name of the Prismic repository to query.
 * @property {string} accessToken - API token to query the Prismic API.
 * @property {funcion} fetchLinks - Array of values that determines how Prismic fetches linked fields.
 * @property {function} linkResolver - Function for Prismic to resolve links in the queried document.
 *    @see {@link https://prismic.io/docs/javascript/beyond-the-api/link-resolving}
 * @property {function} htmlSerializer - Function that allows Prismic to preprocess rich text fields.
 *    @see {@link https://prismic.io/docs/javascript/beyond-the-api/html-serializer}
 * @property {string} typePathsFilenamePrefix - Prefix to the typePaths json we generate at build time.
 * @property {string} schemasDigest - Used for gatsby internals.
 * @property {string} pathResolver - Function that allows for custom preview page path resolving.
 */

/**
 * Validates location sent to our hook.
 * @private
 *
 * @param {Object} rawLocation - Location object from `@reach/router`
 *
 * @throws When `location is not valid.
 */


const validateLocation = rawLocation => {
  const schema = object().shape({
    search: string().nullable(),
    ancestorOrigins: object().notRequired().nullable(),
    assign: mixed().notRequired().nullable(),
    hash: string().notRequired().nullable(),
    host: string().notRequired().nullable(),
    hostname: string().notRequired().nullable(),
    href: string().notRequired().nullable(),
    key: string().notRequired().nullable(),
    origin: string().notRequired().nullable(),
    pathname: string().notRequired().nullable(),
    port: string().notRequired().nullable(),
    protocol: string().notRequired().nullable(),
    reload: mixed().notRequired().nullable(),
    replace: mixed().notRequired().nullable(),
    state: object().notRequired().nullable(),
    toString: mixed().notRequired().nullable()
  });
  return schema.validateSync(rawLocation);
};
/**
 * Retrieves plugin options from `window`.
 * @private
 *
 * @param {string} repositoryName - Name of the repository.
 * @returns Global plugin options. Only plugin options that can be serialized
 * by JSON.stringify() are provided.
 */

const getGlobalPluginOptions = repositoryName => {
  return IS_BROWSER ? (window[GLOBAL_STORE_KEY] || {})[repositoryName] : {};
};
/**
 * Fetches raw Prismic preview document data from their api.
 * @private
 *
 * @param {string} id - ID of the prismic document to preview.
 * @param {Object} pluginOptions - The {@link pluginOptions} to fetch preview data with.
 *
 * @returns Raw preview data object from Prismic.
 */

const fetchPreviewData = async (id, pluginOptions) => {
  const {
    repositoryName,
    accessToken,
    fetchLinks
  } = pluginOptions;
  const apiEndpoint = "https://".concat(repositoryName, ".cdn.prismic.io/api/v2");
  const client = await Prismic.getApi(apiEndpoint, {
    accessToken
  });
  return client.getByID(id, {
    fetchLinks
  });
};
/**
 * Retrieves the typePaths definition file that we create at build time to also normalize our types in the browser.
 * @private
 *
 * @param {Object} pluginOptions - The {@link pluginOptions} to get our type paths file name from
 * @returns The typePaths JSON object for use when normalizing data in the browser.
 */

const fetchTypePaths = async pluginOptions => {
  const {
    typePathsFilenamePrefix,
    schemasDigest
  } = pluginOptions;
  const req = await fetch("/".concat(typePathsFilenamePrefix).concat(schemasDigest, ".json"), {
    headers: {
      'Content-Type': 'application/json'
    }
  });
  return await req.json();
};
/**
 * Normalizes a preview response from Prismic to be the same shape as what is generated at build time.
 * @private
 *
 * @param {Object} previewData - previewData from `fetchPreviewData()` @see {@link fetchPreviewData} for more info.
 * @param {Object} typePaths - typePaths from `fetchTypePaths()` @see {@link fetchTypePaths} for more info.
 * @param {Object} pluginOptions - The {@link pluginOptions} to use when normalizing and fetching data.
 */

const normalizePreviewData = async (previewData, typePaths, pluginOptions) => {
  const rootNodeId = await documentToNodes(previewData, {
    typePaths,
    createNode,
    createNodeId,
    createContentDigest,
    hasNodeById,
    getNodeById,
    pluginOptions,
    normalizeImageField,
    normalizeLinkField,
    normalizeSlicesField,
    normalizeStructuredTextField
  });
  const rootNode = nodeStore.get(rootNodeId);
  const prefixedType = camelCase(rootNode.internal.type);
  return {
    [prefixedType]: rootNode
  };
};
/**
 * Function that is passed to lodash's `mergeWith()` to replace arrays during object merges instead of
 * actually merging them. This fixes unintended behavior when merging repeater fields from previews.
 * @private
 *
 * @param {Object} obj - Object being merged.
 * @param {Object} src - Source object being merge.
 *
 * @returns src when obj is an Array.
 */

const mergeCopyArrays = (obj, src) => Array.isArray(obj) ? src : undefined;
/**
 * Traversally merges key-value pairs.
 * @private
 *
 * @param {Object} staticData - Static data generated at buildtime.
 * @param {Object} previewData - Normalized preview data. @see {@link normalizePreviewData} for more info.
 * @param {String} key - Key that determines the preview data type to replace inside static data.
 *
 * @returns A new object containing the traversally merged key-value pairs from `previewData` and `staticData`
 */


const _traversalMerge = (staticData, previewData, key) => {
  const {
    data: previewDocData,
    id: previewId
  } = previewData[key];

  function handleNode(node) {
    if (typeof node === 'object' && node.id === previewId) {
      this.update(mergeWith(node, {
        data: previewDocData
      }, mergeCopyArrays));
    }
  }

  return traverse(staticData).map(handleNode);
};
/**
 * Merges static and preview data objects together. If the objects share the same top level key, perform
 * a recursive merge. If the objects do not share the same top level key, traversally merge them.
 * @private
 *
 * @param {Object} staticData - Static data generated at buildtime.
 * @param {Object} previewData - Normalized preview data. @see {@link normalizePreviewData} for more info.
 *
 * @returns Object containing the merge contents of staticData and previewData.
 */


const _mergeStaticData = (staticData, previewData) => {
  const previewKey = Object.keys(previewData)[0];
  if (!staticData.hasOwnProperty(previewKey)) return _traversalMerge(staticData, previewData, previewKey);
  return mergeWith(staticData, previewData, mergeCopyArrays);
};
/**
 * Helper that merge's Gatsby's static data with normalized preview data.
 * If the custom types are the same, deep merge with static data.
 * If the custom types are different, deeply replace any document in the static data that matches the preivew document's ID.
 * @public
 *
 * @param {Object} data - Data to merge.
 * @param data.staticData - Static data from Gatsby.
 * @param data.previewData - Preview data from `usePrismicPreview()`.
 *
 * @returns An object containing the merged contents of previewData and staticData.
 */


const mergePrismicPreviewData = ({
  staticData,
  previewData
}) => {
  if (!staticData && !previewData) throw new Error('Invalid data! Please provide at least staticData or previewData.');
  if (!staticData) return previewData;
  if (!previewData) return staticData;
  const clonedStaticData = cloneDeep(staticData);
  return _mergeStaticData(clonedStaticData, previewData);
};

/**
 * @typedef {Object} pluginOptions
 * @property {string} repositoryName - Name of the Prismic repository to query.
 * @property {string} accessToken - API token to query the Prismic API.
 * @property {funcion} fetchLinks - Array of values that determines how Prismic fetches linked fields.
 * @property {function} linkResolver - Function for Prismic to resolve links in the queried document.
 *    @see {@link https://prismic.io/docs/javascript/beyond-the-api/link-resolving}
 * @property {function} htmlSerializer - Function that allows Prismic to preprocess rich text fields.
 *    @see {@link https://prismic.io/docs/javascript/beyond-the-api/html-serializer}
 * @property {string} typePathsFilenamePrefix - Prefix to the typePaths json we generate at build time.
 * @property {string} schemasDigest - Used for gatsby internals.
 * @property {string} pathResolver - Function that allows for custom preview page path resolving.
 */

/**
 * React hook providing preview data from Prismic identical in shape to the data
 * created at build time. Images are not processed due to running in the browser.
 * Instead, images reutrn their URL.
 * @public
 *
 * @param {Object} rawLocation - Location object from @reach/router.
 * @param {Object} rawPluginOptions - The {@link pluginOptions} for this preview.
 *
 * @returns An object containing normalized Prismic preview data directly from
 *    the Prismic API.
 */

const usePrismicPreview = (rawLocation, rawPluginOptions = {}) => {
  const [state, setState] = useState({
    previewData: null,
    path: null
  });
  const globalPluginOptions = getGlobalPluginOptions(rawPluginOptions.repositoryName) || {};
  rawPluginOptions = _objectSpread2({
    schemasDigest: globalPluginOptions.schemasDigest
  }, globalPluginOptions.pluginOptions, {}, rawPluginOptions);
  const location = validateLocation(rawLocation);
  const {
    token,
    documentId
  } = queryString.parse(location.search);
  const isPreview = Boolean(token && documentId);
  let pluginOptions = rawPluginOptions;
  let shareLink = '';

  if (isPreview) {
    pluginOptions = validatePluginOptions(rawPluginOptions, {
      schemas: false
    });
    const {
      websitePreviewId
    } = queryString.parse(token.split('?')[1]);
    const version = token.split('?')[0].split(':')[2];
    const queryParams = queryString.stringify({
      previewId: websitePreviewId,
      document: documentId,
      version
    });
    shareLink = "https://".concat(pluginOptions.repositoryName, ".prismic.io/previews/session/draft?").concat(queryParams);
  }

  const asyncEffect = useCallback(async () => {
    // If not a preview, reset state and return early.
    if (!isPreview) return; // Required to send preview cookie on all API requests on future routes.

    set(Prismic.previewCookie, token);
    const rawPreviewData = await fetchPreviewData(documentId, pluginOptions);
    const typePaths = await fetchTypePaths(pluginOptions);
    const normalizedPreviewData = await normalizePreviewData(rawPreviewData, typePaths, pluginOptions);
    const pathResolver = pluginOptions.pathResolver || pluginOptions.linkResolver;
    setState({
      previewData: normalizedPreviewData,
      path: pathResolver({})(rawPreviewData)
    });
  }, [documentId, pluginOptions, token]);
  useEffect(() => {
    asyncEffect();
  }, []);
  return _objectSpread2({}, state, {
    isPreview,
    shareLink
  });
};

export { mergePrismicPreviewData, usePrismicPreview };
//# sourceMappingURL=index.esm.js.map
