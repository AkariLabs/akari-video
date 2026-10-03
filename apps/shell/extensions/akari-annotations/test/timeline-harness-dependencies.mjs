import uriModule from '@theia/core/lib/common/uri.js';
import { timelineEditPath } from '../lib/node/timeline-target.js';

// AST tests run individual widget methods outside their module. Supply the
// timeline imports that those methods normally receive from the module scope.
const URI = uriModule.default ?? uriModule;
const timelineUri = (root, name) => root.resolve?.(name) ?? new URI(root.toString()).resolve(name);
const currentTimelineEditUri = root => timelineUri(root, 'edit.json');
const currentTimelineCaptionsUri = root => timelineUri(root, 'captions.json');
const activeEditRequest = root => ({ editUri: new URI(root.toString()).resolve('edit.json').toString() });
const editUriForVisibleTimeline = widget => widget.isVisible ? widget.timelineLocation?.editUri : undefined;

Object.assign(globalThis, {
  currentTimelineEditUri, currentTimelineCaptionsUri, activeEditRequest,
  editUriForVisibleTimeline, timelineEditPath,
  active_timeline_1: { currentTimelineEditUri, currentTimelineCaptionsUri },
  types_1: { activeEditRequest },
  uri_1: { default: URI }
});
