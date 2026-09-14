from django.db import migrations
from django.contrib.auth.hashers import identify_hasher, make_password


def secure_legacy_data(apps, schema_editor):
    Users = apps.get_model("users", "Users")
    Doctors = apps.get_model("users", "Doctors")

    doctor_user_ids = set(Doctors.objects.values_list("user_id", flat=True))
    for user in Users.objects.all().iterator():
        updates = []
        # Any value Django cannot identify as a password hash is disabled. Users can
        # regain access through the password-reset flow; plaintext is never retained.
        try:
            identify_hasher(user.password)
        except (ValueError, TypeError):
            user.password = make_password(None)
            updates.append("password")

        should_be_doctor = user.pk in doctor_user_ids
        if user.is_doctor != should_be_doctor:
            user.is_doctor = should_be_doctor
            updates.append("is_doctor")

        if updates:
            user.save(update_fields=updates)


class Migration(migrations.Migration):
    dependencies = [("users", "0014_alter_specialty_options_reste_token_created_at_and_more")]
    operations = [migrations.RunPython(secure_legacy_data, migrations.RunPython.noop)]
