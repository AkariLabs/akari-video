export const BrowserPreferences = {
    schema: { properties: {
        'akari.browser.userEngines': {
            type: 'array', default: [], maxItems: 12,
            description: 'ブラウザの検索サイトを追加します。',
            items: { type: 'object', additionalProperties: false,
                required: ['id', 'label', 'template'],
                properties: { id: { type: 'string' }, label: { type: 'string' }, template: { type: 'string' } } }
        }
    } }
};
