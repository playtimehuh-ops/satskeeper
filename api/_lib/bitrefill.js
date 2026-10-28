'use strict';

function providerError(code, message) {
  const err = new Error(message);
  err.statusCode = 501;
  err.code = code;
  return err;
}

/**
 * Gift card issuing adapter.
 *
 * GIFT_CARD_PROVIDER=manual (default): nothing is purchased automatically. The result carries
 * instructions for the human operator, who buys the card by hand and pastes the code into the dashboard.
 * Bitrefill's anonymous tier is web-only and has no public account-free API, so there is no automated path.
 *
 * Any other provider throws until an adapter for it is written here.
 */
async function issueGiftCard({ redemption, device, provider }) {
  const name = String(provider || process.env.GIFT_CARD_PROVIDER || 'manual').toLowerCase();

  if (name === 'manual') {
    const dollars = (redemption.value_cents / 100).toFixed(2);
    return {
      provider: 'manual',
      status: 'manual_required',
      code: null,
      instructions: [
        `Buy a gift card worth $${dollars} by hand (for example on the Bitrefill website).`,
        `Recipient: device ${device && device.handle ? device.handle : redemption.device_id}.`,
        'Re-check the provider terms and your SDK partner policy before paying.',
        'Paste the card code into the Redemptions tab and press "Mark paid".',
      ],
    };
  }

  if (name === 'bitrefill') {
    throw providerError(
      'provider_not_implemented',
      'GIFT_CARD_PROVIDER=bitrefill is not implemented: Bitrefill has no public account-free API. Use GIFT_CARD_PROVIDER=manual.'
    );
  }

  throw providerError(
    'provider_not_implemented',
    `GIFT_CARD_PROVIDER="${name}" is not implemented. Supported: manual.`
  );
}

module.exports = { issueGiftCard };
