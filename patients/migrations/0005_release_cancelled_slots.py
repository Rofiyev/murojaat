from django.db import migrations


def release_cancelled_slots(apps, schema_editor):
    Appointment = apps.get_model("patients", "Appointment")
    Appointment.objects.filter(status__status="Cancelled").update(slot_reserved=False)


class Migration(migrations.Migration):
    dependencies = [("patients", "0004_alter_appointment_options_alter_status_options_and_more")]
    operations = [migrations.RunPython(release_cancelled_slots, migrations.RunPython.noop)]
