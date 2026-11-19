'use strict';
const secondarySection = (section, index = 0) => section.color_index != null ? section.color_index % 2 === 1 : section.polarity === 'UNHELPFUL' || index % 2 === 1;
const sectionAnchor = (section, index) => section.polarity === 'HELPFUL' ? 'helpful' : section.polarity === 'UNHELPFUL' ? 'unhelpful' : 'discussion-section-' + (index + 1);
module.exports = { secondarySection, sectionAnchor };
