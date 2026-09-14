from pathlib import Path

from django.conf import settings
from django.core.management import BaseCommand, call_command
from django.contrib.auth import get_user_model


class Command(BaseCommand):
    help = "Load the bundled legacy dataset only when the user table is empty."

    def handle(self, *args, **options):
        User = get_user_model()
        if User.objects.exists():
            self.stdout.write(self.style.WARNING("Database already has users; seed skipped."))
            return
        fixture = Path(settings.BASE_DIR) / "deployment_seed.json"
        if not fixture.exists():
            self.stdout.write(self.style.WARNING("deployment_seed.json not found; seed skipped."))
            return
        call_command("loaddata", str(fixture), verbosity=1)
        self.stdout.write(self.style.SUCCESS("Initial dataset loaded."))
