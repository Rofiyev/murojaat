from django.core.exceptions import ValidationError


def validate_file_size(file_obj):
    max_size = 5 * 1024 * 1024
    if file_obj.size > max_size:
        raise ValidationError("Rasm hajmi 5 MB dan oshmasligi kerak.")
