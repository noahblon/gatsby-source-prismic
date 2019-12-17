'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

function _interopDefault (ex) { return (ex && (typeof ex === 'object') && 'default' in ex) ? ex['default'] : ex; }

var fs = _interopDefault(require('fs'));
var path = _interopDefault(require('path'));
var R = require('ramda');
var RA = require('ramda-adjunct');
var md5 = _interopDefault(require('md5'));
var yup = require('yup');
var Prismic = _interopDefault(require('prismic-javascript'));
var pascalcase = _interopDefault(require('pascalcase'));
var PrismicDOM = _interopDefault(require('prismic-dom'));
var compose = _interopDefault(require('compose-tiny'));
var gatsbySourceFilesystem = require('gatsby-source-filesystem');

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

function _objectWithoutPropertiesLoose(source, excluded) {
  if (source == null) return {};
  var target = {};
  var sourceKeys = Object.keys(source);
  var key, i;

  for (i = 0; i < sourceKeys.length; i++) {
    key = sourceKeys[i];
    if (excluded.indexOf(key) >= 0) continue;
    target[key] = source[key];
  }

  return target;
}

function _objectWithoutProperties(source, excluded) {
  if (source == null) return {};

  var target = _objectWithoutPropertiesLoose(source, excluded);

  var key, i;

  if (Object.getOwnPropertySymbols) {
    var sourceSymbolKeys = Object.getOwnPropertySymbols(source);

    for (i = 0; i < sourceSymbolKeys.length; i++) {
      key = sourceSymbolKeys[i];
      if (excluded.indexOf(key) >= 0) continue;
      if (!Object.prototype.propertyIsEnumerable.call(source, key)) continue;
      target[key] = source[key];
    }
  }

  return target;
}

var name = "gatsby-source-prismic";

const msg = s => "".concat(name, " - ").concat(s);

const pagedGet = async (client, queryOptions, context, pageSize = 100, page = 1, acc = []) => {
  const {
    gatsbyContext: {
      reporter
    }
  } = context;
  reporter.verbose(msg("fetching documents page ".concat(page)));
  const response = await client.query([], _objectSpread2({}, queryOptions, {
    page,
    pageSize
  }));
  acc = acc.concat(response.results);
  if (page * pageSize < response.total_results_size) return pagedGet(client, queryOptions, context, pageSize, page + 1, acc);
  return acc;
};

const fetchAllDocuments = async (gatsbyContext, pluginOptions) => {
  const {
    repositoryName,
    accessToken,
    fetchLinks,
    lang,
    ref
  } = pluginOptions;
  const apiEndpoint = "https://".concat(repositoryName, ".prismic.io/api/v2");
  const client = await Prismic.api(apiEndpoint, {
    accessToken
  });
  return await pagedGet(client, {
    fetchLinks,
    lang,
    ref
  }, {
    gatsbyContext,
    pluginOptions
  });
};

const IMAGE_FIELD_KEYS = ['dimensions', 'alt', 'copyright', 'url', 'localFile']; // Returns a GraphQL type name given a field based on its type. If the type is
// is an object or union, the necessary type definition is enqueued on to the
// provided queue to be created at a later time.

const fieldToType = (id, value, depth, context) => {
  const {
    customTypeId,
    enqueueTypeDef,
    enqueueTypePath,
    gatsbyContext
  } = context;
  const {
    schema: gatsbySchema,
    createNodeId
  } = gatsbyContext;

  switch (value.type) {
    case 'UID':
      enqueueTypePath([...depth, id], 'String');
      return {
        type: 'String',
        description: "The document's unique identifier. Unique among all instances of the document's type."
      };

    case 'Color':
    case 'Select':
    case 'Text':
      enqueueTypePath([...depth, id], 'String');
      return 'String';

    case 'StructuredText':
      enqueueTypePath([...depth, id], 'PrismicStructuredTextType');
      return 'PrismicStructuredTextType';

    case 'Number':
      enqueueTypePath([...depth, id], 'Float');
      return 'Float';

    case 'Date':
    case 'Timestamp':
      enqueueTypePath([...depth, id], 'Date');
      return 'Date';

    case 'GeoPoint':
      enqueueTypePath([...depth, id], 'PrismicGeoPointType');
      return 'PrismicGeoPointType';

    case 'Embed':
      enqueueTypePath([...depth, id], 'PrismicEmbedType');
      return 'PrismicEmbedType';

    case 'Image':
      enqueueTypePath([...depth, id], 'PrismicImageType');
      return {
        type: 'PrismicImageType',
        resolve: (parent, args, context, info) => {
          const key = info.path.key;
          const value = parent[key];

          const getFileNode = id => context.nodeModel.getNodeById({
            id,
            type: 'File'
          });

          const baseValue = R.compose(R.assoc('localFile', getFileNode(value.localFile)), R.pick(IMAGE_FIELD_KEYS))(value);
          const thumbValues = R.compose(R.mapObjIndexed(v => R.assoc('localFile', getFileNode(v.localFile), v)), R.omit(IMAGE_FIELD_KEYS))(value);
          return _objectSpread2({}, baseValue, {}, thumbValues);
        }
      };

    case 'Link':
      enqueueTypePath([...depth, id], 'PrismicLinkType');
      return {
        type: 'PrismicLinkType',
        resolve: (parent, args, context, info) => {
          const key = info.path.key;
          const value = parent[key];
          return _objectSpread2({}, value, {
            document: context.nodeModel.getNodeById({
              id: createNodeId("".concat(value.type, " ").concat(value.id)),
              type: pascalcase("Prismic ".concat(value.type))
            })
          });
        }
      };

    case 'Group':
      const groupName = pascalcase("Prismic ".concat(customTypeId, " ").concat(id, " Group Type"));
      const subfields = value.config.fields;
      enqueueTypeDef(gatsbySchema.buildObjectType({
        name: groupName,
        fields: R.mapObjIndexed((subfield, subfieldId) => fieldToType(subfieldId, subfield, [...depth, id], context), subfields)
      }));
      enqueueTypePath([...depth, id], "[".concat(groupName, "]"));
      return "[".concat(groupName, "]");

    case 'Slice':
      const {
        sliceZoneId
      } = context;
      const {
        'non-repeat': primaryFields,
        repeat: itemsFields
      } = value;
      const sliceFields = {
        id: 'String',
        slice_type: 'String'
      };

      if (primaryFields && !R.isEmpty(primaryFields)) {
        const primaryName = pascalcase("Prismic ".concat(customTypeId, " ").concat(sliceZoneId, " ").concat(id, " Primary Type"));
        enqueueTypeDef(gatsbySchema.buildObjectType({
          name: primaryName,
          fields: R.mapObjIndexed((primaryField, primaryFieldId) => fieldToType(primaryFieldId, primaryField, [...depth, id, 'primary'], context), primaryFields)
        }));
        enqueueTypePath([...depth, id, 'primary'], primaryName);
        sliceFields.primary = "".concat(primaryName);
      }

      if (itemsFields && !R.isEmpty(itemsFields)) {
        const itemName = pascalcase("Prismic ".concat(customTypeId, " ").concat(sliceZoneId, " ").concat(id, " Item Type"));
        enqueueTypeDef(gatsbySchema.buildObjectType({
          name: itemName,
          fields: R.mapObjIndexed((itemField, itemFieldId) => fieldToType(itemFieldId, itemField, [...depth, id, 'items'], context), itemsFields)
        }));
        enqueueTypePath([...depth, id, 'items'], "[".concat(itemName, "]"));
        sliceFields.items = "[".concat(itemName, "]");
      }

      const sliceName = pascalcase("Prismic ".concat(customTypeId, " ").concat(sliceZoneId, " ").concat(id));
      enqueueTypeDef(gatsbySchema.buildObjectType({
        name: sliceName,
        fields: sliceFields,
        interfaces: ['Node']
      }));
      enqueueTypePath([...depth, id], sliceName);
      return sliceName;

    case 'Slices':
      const choiceTypes = R.compose(R.values, R.mapObjIndexed((choice, choiceId) => fieldToType(choiceId, choice, [...depth, id], _objectSpread2({}, context, {
        sliceZoneId: id
      }))))(value.config.choices);
      const slicesName = pascalcase("Prismic ".concat(customTypeId, " ").concat(id, " Slices Type"));
      enqueueTypeDef(gatsbySchema.buildUnionType({
        name: slicesName,
        types: choiceTypes
      }));
      enqueueTypePath([...depth, id], "[".concat(slicesName, "]"));
      return {
        type: "[".concat(slicesName, "]"),
        resolve: (parent, args, context, info) => context.nodeModel.getNodesByIds({
          ids: parent[info.path.key]
        })
      };

    default:
      console.log("UNPROCESSED FIELD for type \"".concat(value.type, "\""), id);
      return null;
  }
};

const generateTypeDefsForCustomType = (id, json, context) => {
  const {
    gatsbyContext
  } = context;
  const {
    schema: gatsbySchema
  } = gatsbyContext;
  const typeDefs = [];

  const enqueueTypeDef = typeDef => typeDefs.push(typeDef);

  const typePaths = [];

  const enqueueTypePath = (path, type) => typePaths.push({
    path,
    type
  }); // UID fields are defined at the same level as data fields, but are a level
  // about data in API responses. Pulling it out separately here allows us to
  // process the UID field differently than the data fields.


  const _R$compose = R.compose(R.mergeAll, R.values)(json),
        {
    uid: uidField
  } = _R$compose,
        dataFields = _objectWithoutProperties(_R$compose, ["uid"]); // UID fields must be conditionally processed since not all custom types
  // implement a UID field.


  let uidFieldType;
  if (uidField) uidFieldType = fieldToType('uid', uidField, [id], _objectSpread2({}, context, {
    customTypeId: id,
    enqueueTypePath
  }));
  const dataFieldTypes = R.mapObjIndexed((field, fieldId) => fieldToType(fieldId, field, [id, 'data'], _objectSpread2({}, context, {
    customTypeId: id,
    enqueueTypeDef,
    enqueueTypePath
  })), dataFields);
  const dataName = pascalcase("Prismic ".concat(id, " Data Type"));
  enqueueTypePath([id, 'data'], dataName);
  enqueueTypeDef(gatsbySchema.buildObjectType({
    name: dataName,
    fields: dataFieldTypes
  }));
  const customTypeName = pascalcase("Prismic ".concat(id));
  const customTypeFields = {
    data: {
      type: dataName,
      description: "The document's data fields."
    },
    dataRaw: {
      type: 'JSON!',
      description: "The document's data object without transformations exactly as it comes from the Prismic API."
    },
    dataString: {
      type: 'String!',
      description: "The document's data object without transformations. The object is stringified via `JSON.stringify` to eliminate the need to declare subfields.",
      deprecationReason: 'Use `dataRaw` instead which returns JSON.'
    },
    first_publication_date: {
      type: 'Date!',
      description: "The document's initial publication date."
    },
    href: {
      type: 'String!',
      description: "The document's Prismic API URL."
    },
    url: {
      type: 'String',
      description: "The document's URL derived via the link resolver."
    },
    id: {
      type: 'ID!',
      description: 'Globally unique identifier. Note that this differs from the `prismicID` field.'
    },
    lang: {
      type: 'String!',
      description: "The document's language."
    },
    last_publication_date: {
      type: 'Date!',
      description: "The document's most recent publication date"
    },
    tags: {
      type: '[String!]!',
      description: "The document's list of tags."
    },
    type: {
      type: 'String!',
      description: "The document's Prismic API ID type."
    },
    prismicId: {
      type: 'ID!',
      description: "The document's Prismic ID."
    }
  };
  if (uidFieldType) customTypeFields.uid = uidFieldType;
  enqueueTypePath([id], customTypeName);
  enqueueTypeDef(gatsbySchema.buildObjectType({
    name: customTypeName,
    fields: customTypeFields,
    interfaces: ['PrismicDocument', 'Node']
  }));
  return {
    typeDefs,
    typePaths
  };
};
const generateTypeDefForLinkType = (allTypeDefs, context) => {
  const {
    gatsbyContext
  } = context;
  const {
    schema: gatsbySchema
  } = gatsbyContext;
  const documentTypeNames = R.compose(R.map(R.path(['config', 'name'])), R.filter(R.compose(R.contains('PrismicDocument'), R.pathOr([], ['config', 'interfaces']))))(allTypeDefs);
  return gatsbySchema.buildUnionType({
    name: 'PrismicAllDocumentTypes',
    types: documentTypeNames
  });
};

const IMAGE_FIELD_KEYS$1 = ['dimensions', 'alt', 'copyright', 'url', 'localFile'];

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
      const base = await compose(baseValue => normalizeImageField(id, baseValue, depth, context), pick(IMAGE_FIELD_KEYS$1))(value); // Thumbnail image data are siblings of the base image data so we need to
      // smartly extract and normalize the key-value pairs.

      const thumbs = await compose(mapObj(async ([k, v]) => [k, await normalizeImageField(id, v, depth, context)]), omit(IMAGE_FIELD_KEYS$1))(value);
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
}; // Normalizes a PrismicLinkType field by providing a resolved URL using
// `prismic-dom` on the `url` field. If the value is a document link, the
// document's data is provided on the `document` key.
//
// NOTE: The document field is set to a node ID but this will be resolved to
// the node in the GraphQL resolver.

const normalizeLinkField = async (id, value, _depth, context) => {
  const {
    doc,
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
  let documentId = null;
  if (value.link_type === 'Document') documentId = createNodeId("".concat(value.type, " ").concat(value.id));
  return _objectSpread2({}, value, {
    url: PrismicDOM.Link.url(value, linkResolverForField),
    document: documentId,
    raw: value
  });
}; // Normalizes a PrismicImageType field by creating a File node using
// `gatsby-source-filesystem`. This allows for `gatsby-transformer-sharp` and
// `gatsby-image` integration. The linked node data is provided on the
// `localFile` key.
//
// NOTE: The localFile field is set to a node ID but this will be resolved to
// the node in the GraphQL resolver.

const normalizeImageField = async (id, value, _depth, context) => {
  const {
    doc,
    docNodeId,
    gatsbyContext,
    pluginOptions
  } = context;
  const {
    createNodeId,
    store,
    cache,
    actions
  } = gatsbyContext;
  const {
    createNode
  } = actions;
  const {
    shouldNormalizeImage
  } = pluginOptions;
  const shouldAttemptToCreateRemoteFileNode = await shouldNormalizeImage({
    key: id,
    value,
    node: doc
  });
  let fileNode;

  if (shouldAttemptToCreateRemoteFileNode && value.url) {
    try {
      fileNode = await gatsbySourceFilesystem.createRemoteFileNode({
        url: decodeURIComponent(value.url),
        parentNodeId: docNodeId,
        store,
        cache,
        createNode,
        createNodeId
      });
    } catch (error) {// Ignore
    }
  }

  return _objectSpread2({}, value, {
    localFile: fileNode ? fileNode.id : null
  });
}; // Normalizes a SlicesType field by returning the value as-is.

const normalizeSlicesField = (_id, value) => value;

var standardTypes = "\"A text field with formatting options.\"\ntype PrismicStructuredTextType {\n  \"The HTML value of the text using `prismic-dom` and the HTML serializer.\"\n  html: String\n  \"The plain text value of the text using `prismic-dom`.\"\n  text: String\n  \"The field's value without transformations exactly as it comes from the Prismic API.\"\n  raw: JSON\n}\n\n\"A field for storing geo-coordinates.\"\ntype PrismicGeoPointType {\n  \"The latitude value of the geo-coordinate.\"\n  latitude: Float\n  \"The longitude value of the geo-coordinate.\"\n  longitude: Float\n}\n\n\"Embed videos, songs, tweets, slices, etc.\"\ntype PrismicEmbedType {\n  \"The name of the author/owner of the resource. Fetched via oEmbed data.\"\n  author_name: String\n  \"A URL for the author/owner of the resource. Fetched via oEmbed data.\"\n  author_url: String\n  \"The suggested cache lifetime for this resource, in seconds. Consumers may choose to use this value or not. Fetched via oEmbed data.\"\n  cache_age: String\n  \"The URL of the resource.\"\n  embed_url: String\n  \"The HTML required to display the resource. The HTML should have no padding or margins. Consumers may wish to load the HTML in an off-domain iframe to avoid XSS vulnerabilities. Fetched via oEmbed data.\"\n  html: String\n  \"The name of the resource.\"\n  name: String\n  \"The name of the resource provider. Fetched via oEmbed data.\"\n  provider_name: String\n  \"The URL of the resource provider. Fetched via oEmbed data.\"\n  provider_url: String\n  \"The width of the resource's thumbnail. Fetched via oEmbed data.\"\n  thumbnail_height: Int\n  \"A URL to a thumbnail image representing the resource. Fetched via oEmbed data.\"\n  thumbnail_url: String\n  \"The width of the resource's thumbnail. Fetched via oEmbed data.\"\n  thumbnail_width: Int\n  \"A text title, describing the resource. Fetched via oEmbed data.\"\n  title: String\n  \"The resource type. Fetched via oEmbed data.\"\n  type: String\n  \"The oEmbed version number.\"\n  version: String\n}\n\n\"Dimensions for images.\"\ntype PrismicImageDimensionsType {\n  \"Width of the image in pixels.\"\n  width: Int!\n  \"Height of the image in pixels.\"\n  height: Int!\n}\n\n\"A responsive image field with constraints.\"\ntype PrismicImageType {\n  \"The image's alternative text.\"\n  alt: String\n  \"The image's copyright text.\"\n  copyright: String\n  \"The image's dimensions.\"\n  dimensions: PrismicImageDimensionsType\n  \"The image's URL on Prismic's CDN.\"\n  url: String\n  \"The locally downloaded image if `shouldNormalizeImage` returns true.\"\n  localFile: File\n}\n\n\"Types of links.\"\nenum PrismicLinkTypes {\n  \"Any of the other types\"\n  Any\n  \"Internal content\"\n  Document\n  \"Internal media content\"\n  Media\n  \"URL\"\n  Web\n}\n\n\"Link to web, media, and internal content.\"\ntype PrismicLinkType {\n  \"The type of link.\"\n  link_type: PrismicLinkTypes!\n  \"If a Document link, `true` if linked document does not exist, `false` otherwise.\"\n  isBroken: Boolean\n  \"The link URL using `prismic-dom` the link resolver.\"\n  url: String\n  \"The link's target.\"\n  target: String\n  \"If a Document link, the linked document's Prismic ID.\"\n  id: ID\n  \"If a Document link, the linked document's Prismic custom type API ID\"\n  type: String\n  \"If a Document link, the linked document's list of tags.\"\n  tags: [String]\n  \"If a Document link, the linked document's language.\"\n  lang: String\n  \"If a Document link, the linked document's slug.\"\n  slug: String\n  \"If a Document link, the linked document's UID.\"\n  uid: String\n  \"If a Document link, the linked document.\"\n  document: PrismicAllDocumentTypes\n  \"The field's value without transformations exactly as it comes from the Prismic API.\"\n  raw: JSON\n}\n\ninterface PrismicDocument {\n  dataString: String\n  first_publication_date: Date\n  href: String\n  id: ID!\n  lang: String\n  last_publication_date: Date\n  # tags: [String]\n  type: String\n}\n";

const msg$1 = s => "".concat(name, " - ").concat(s);

const sourceNodes = async (gatsbyContext, rawPluginOptions) => {
  const {
    actions,
    reporter
  } = gatsbyContext;
  const {
    createTypes
  } = actions;
  const createTypesActivity = reporter.activityTimer(msg$1('create types'));
  const fetchDocumentsActivity = reporter.activityTimer(msg$1('fetch documents'));
  const createNodesActivity = reporter.activityTimer(msg$1('create nodes'));
  const writeTypePathsActivity = reporter.activityTimer(msg$1('write out type paths'));
  /***
   * Validate plugin options. Set default options where necessary. If any
   * plugin options are invalid, stop immediately.
   */

  let pluginOptions;

  try {
    pluginOptions = validatePluginOptions(rawPluginOptions, {
      pathResolver: false,
      schemasDigest: false
    });
  } catch (error) {
    reporter.error(msg$1('invalid plugin options'));
    reporter.panic(msg$1(error.errors.join(', ')));
  }
  /***
   * Create types derived from Prismic custom type schemas.
   */


  createTypesActivity.start();
  reporter.verbose(msg$1('starting to create types'));
  const typeVals = R.compose(R.values, R.mapObjIndexed((json, id) => generateTypeDefsForCustomType(id, json, {
    gatsbyContext,
    pluginOptions
  })))(pluginOptions.schemas);
  const typeDefs = R.compose(R.flatten, R.map(R.prop('typeDefs')))(typeVals);
  const typePaths = R.compose(R.flatten, R.map(R.prop('typePaths')))(typeVals);
  const linkTypeDef = generateTypeDefForLinkType(typeDefs, {
    gatsbyContext
  });
  createTypes(standardTypes);
  createTypes(linkTypeDef);
  createTypes(typeDefs);
  createTypesActivity.end();
  /***
   * Fetch documents from Prismic.
   */

  fetchDocumentsActivity.start();
  reporter.verbose(msg$1('starting to fetch documents'));
  const documents = await fetchAllDocuments(gatsbyContext, pluginOptions);
  reporter.verbose(msg$1("fetched ".concat(documents.length, " documents")));
  fetchDocumentsActivity.end();
  /***
   * Create nodes for all documents
   */

  createNodesActivity.start();
  reporter.verbose(msg$1('starting to create nodes'));
  await R.compose(RA.allP, R.map(doc => documentToNodes(doc, {
    createNode: node => {
      reporter.verbose(msg$1("creating node ".concat(JSON.stringify({
        id: node.id,
        type: node.internal.type,
        prismicId: node.prismicId
      }))));
      gatsbyContext.actions.createNode(node);
    },
    createNodeId: gatsbyContext.createNodeId,
    createContentDigest: gatsbyContext.createContentDigest,
    normalizeImageField,
    normalizeLinkField,
    normalizeSlicesField,
    normalizeStructuredTextField,
    typePaths,
    gatsbyContext,
    pluginOptions
  })))(documents);
  createNodesActivity.end();
  /***
   * Write type paths to public for use in Prismic previews.
   */

  writeTypePathsActivity.start();
  reporter.verbose(msg$1('starting to write out type paths'));
  const schemasDigest = md5(JSON.stringify(pluginOptions.schemas));
  const typePathsFilename = path.resolve('public', pluginOptions.typePathsFilenamePrefix + schemasDigest + '.json');
  reporter.verbose(msg$1("writing out type paths to: ".concat(typePathsFilename)));
  fs.writeFileSync(typePathsFilename, JSON.stringify(typePaths));
  writeTypePathsActivity.end();
};

exports.sourceNodes = sourceNodes;
//# sourceMappingURL=gatsby-node.js.map
