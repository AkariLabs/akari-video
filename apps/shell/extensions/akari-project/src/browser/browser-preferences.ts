import { t } from '../common/project-text';
export const BrowserPreferences = {
    schema: { properties: {
        'akari.browser.userEngines': {
            type: 'array', default: [], maxItems: 12,
            description: t('project.web.preference.addBrowserSearchSitesAction'),
            items: { type: 'object', additionalProperties: false,
                required: ['id', 'label', 'template'],
                properties: { id: { type: 'string' }, label: { type: 'string' }, template: { type: 'string' } } }
        }
    } }
};
