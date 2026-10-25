"""Placeholder for Stripe Connect payouts to haulers and movers.

Not implemented yet (spec: structure for it, don't build it). Bookings record `vendor_id`, `amount`
and `payout_status="not_applicable"`; a future Connect integration only needs to implement
`create_transfer` and call it from `services.stripe_service.mark_booking_paid`.
"""

from __future__ import annotations


class PayoutProvider:
    async def create_transfer(self, booking: dict, vendor: dict) -> dict:  # pragma: no cover
        raise NotImplementedError("Stripe Connect payouts are not enabled.")


def payouts_enabled() -> bool:
    return False
