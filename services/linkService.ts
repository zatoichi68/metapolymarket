/**
 * Centralize Polymarket URL generation with affiliate parameters.
 */

const AFFILIATE_PARAM = 'via=steve-rioux';

/**
 * Generates a full Polymarket URL for a given event slug or market ID.
 * @param slugOrId The event slug or market ID
 * @returns A full Polymarket URL with affiliate parameters
 */
export const getPolymarketUrl = (slugOrId: string): string => {
    const baseUrl = 'polymarket.com';

    if (!slugOrId) {
        return `https://${baseUrl}/?${AFFILIATE_PARAM}`;
    }

    // Ensure we don't have multiple ? if there are already params (unlikely for slug, but safe)
    const separator = slugOrId.includes('?') ? '&' : '?';

    return `https://${baseUrl}/event/${slugOrId}${separator}${AFFILIATE_PARAM}`;
};
