"""Generates a realistic sample residential lease PDF (fictional landlord) for the demo."""

from __future__ import annotations

from datetime import timedelta

from fpdf import FPDF

from agents.schedule import parse_date

CLAUSES = [
    (
        "1. Parties and Premises",
        'This Residential Lease Agreement is between Bayview Residential Partners LLC ("Landlord") and {tenant} ("Tenant") for the apartment located at {address} ("Premises").',
    ),
    (
        "2. Term",
        "The lease term is 12-month, beginning on {start} and ending on {end}. This lease will automatically renew on a month-to-month basis unless either party gives 60 days written notice before the end of the term.",
    ),
    (
        "3. Rent",
        "Monthly rent is $3,150.00, due on the 1st day of each month. Rent paid after the 3rd day of the month incurs a late fee of $150.00 plus $25.00 for each additional day.",
    ),
    (
        "4. Security Deposit",
        "Tenant will pay a security deposit of $4,725.00 before move-in. Landlord will return the deposit, less lawful deductions, within 21 days after Tenant vacates.",
    ),
    ("5. Move-in Fee", "Tenant agrees to pay a non-refundable move-in fee of $350.00 to cover administrative processing and elevator reservation."),
    ("6. Utilities", "Tenant is responsible for electricity, gas and internet. Water, sewer and trash are billed back monthly at a flat $85.00 utility fee."),
    ("7. Pets", "One cat or small dog is allowed with Landlord approval, a pet deposit of $500.00 and pet rent of $75.00 per month."),
    ("8. Renters Insurance", "Tenant must keep renters insurance with at least $100,000 of liability coverage and provide proof before receiving keys."),
    ("9. Guests", "Guests staying more than 14 consecutive days require written approval from Landlord."),
    ("10. Entry", "Landlord may enter the Premises with 24 hours written notice for repairs, inspections or showings, except in emergencies."),
    ("11. Move-out Cleaning", "At move-out, Tenant will be charged for professional carpet cleaning of $275.00 regardless of the condition of the carpet."),
    ("12. Early Termination", "If Tenant ends the lease early, Tenant will pay an early termination fee equal to two months' rent."),
    ("13. Notice to Vacate", "Tenant must give 60 days written notice before moving out at the end of the term."),
    ("14. Waiver", "Tenant waives any right to a jury trial for disputes arising under this lease."),
]


def sample_lease_pdf(tenant: str, address: str, move_date: str) -> bytes:
    start = parse_date(move_date)
    end = start + timedelta(days=364)
    pdf = FPDF()
    pdf.set_auto_page_break(auto=True, margin=18)
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 16)
    pdf.cell(0, 10, "Residential Lease Agreement", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 9)
    pdf.cell(0, 6, "SAMPLE DOCUMENT FOR DEMO PURPOSES - fictional landlord", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(4)
    values = {
        "tenant": tenant,
        "address": address.encode("latin-1", "replace").decode("latin-1"),
        "start": start.strftime("%B %d, %Y"),
        "end": end.strftime("%B %d, %Y"),
    }
    for title, body in CLAUSES:
        pdf.set_font("Helvetica", "B", 11)
        pdf.cell(0, 7, title, new_x="LMARGIN", new_y="NEXT")
        pdf.set_font("Helvetica", "", 10)
        pdf.multi_cell(0, 5.2, body.format(**values))
        pdf.ln(2)
    pdf.ln(6)
    pdf.set_font("Helvetica", "", 10)
    pdf.cell(0, 6, "Tenant signature: ______________________   Date: __________", new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 6, "Landlord signature: ____________________   Date: __________", new_x="LMARGIN", new_y="NEXT")
    return bytes(pdf.output())
