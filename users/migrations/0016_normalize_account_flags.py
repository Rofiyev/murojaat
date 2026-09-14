from django.db import migrations


def normalize_account_flags(apps, schema_editor):
    Users = apps.get_model("users", "Users")
    Doctors = apps.get_model("users", "Doctors")
    Patients = apps.get_model("users", "Patients")

    doctor_ids = set(Doctors.objects.values_list("user_id", flat=True))
    patient_ids = set(Patients.objects.values_list("user_id", flat=True))

    for user in Users.objects.all().iterator():
        updates = []
        if user.is_superuser and not user.is_staff:
            user.is_staff = True
            updates.append("is_staff")
        has_role = user.pk in doctor_ids or user.pk in patient_ids
        # Keep admin/staff service accounts active; disable role-less public accounts.
        if not has_role and not user.is_staff and user.is_active:
            user.is_active = False
            updates.append("is_active")
        if updates:
            user.save(update_fields=updates)


class Migration(migrations.Migration):
    dependencies = [("users", "0015_secure_legacy_passwords_and_roles")]
    operations = [migrations.RunPython(normalize_account_flags, migrations.RunPython.noop)]
