from django.core.validators import FileExtensionValidator
from django.db import models
from django.utils import timezone

from users.models import Doctors, Users
from users.validators import validate_file_size


class Category(models.Model):
    id_category = models.AutoField(primary_key=True)
    name = models.CharField(max_length=50, unique=True)

    class Meta:
        verbose_name = "Category"
        verbose_name_plural = "Categories"
        ordering = ["name"]

    def __str__(self):
        return self.name


class Blogs(models.Model):
    blog_id = models.AutoField(primary_key=True)
    title = models.CharField(max_length=255)
    description = models.TextField()
    summary = models.TextField()
    is_published = models.BooleanField(default=False, db_index=True)
    posted_at = models.DateTimeField(default=timezone.now, db_index=True)
    thumbnail = models.ImageField(
        upload_to="blogs/thumbnail",
        null=True,
        blank=True,
        validators=[
            FileExtensionValidator(allowed_extensions=["jpg", "jpeg", "png", "webp"]),
            validate_file_size,
        ],
    )
    id_category = models.ForeignKey(Category, on_delete=models.PROTECT)
    doctor = models.ForeignKey(Doctors, on_delete=models.PROTECT, related_name="blogs")

    class Meta:
        verbose_name = "Blog"
        verbose_name_plural = "Blogs"
        ordering = ["-posted_at"]

    def __str__(self):
        return self.title


class Comments(models.Model):
    comment_id = models.AutoField(primary_key=True)
    content = models.TextField(max_length=2000)
    commented_at = models.DateTimeField(default=timezone.now, db_index=True)
    user = models.ForeignKey(Users, on_delete=models.CASCADE)
    blog = models.ForeignKey(Blogs, on_delete=models.CASCADE, related_name="comments")

    class Meta:
        verbose_name = "Comment"
        verbose_name_plural = "Comments"
        ordering = ["commented_at"]

    def __str__(self):
        return f"Comment by {self.user.username} on {self.blog.title}"
