from django.conf import settings
from django.core.mail import send_mail


def send_reset_email(email: str, reset_url: str) -> None:
    subject = "Hospital Management — parolni tiklash"
    message = (
        "Parolingizni tiklash uchun quyidagi xavfsiz havolani oching:\n\n"
        f"{reset_url}\n\n"
        "Agar bu so‘rovni siz yubormagan bo‘lsangiz, xabarni e'tiborsiz qoldiring."
    )
    send_mail(subject, message, settings.DEFAULT_FROM_EMAIL, [email], fail_silently=False)
