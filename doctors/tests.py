from django.test import TestCase
from django.urls import reverse

from users.models import Address, Doctors, Specialty, Users
from .models import Blogs, Category


class BlogOwnershipTests(TestCase):
    def setUp(self):
        address = Address.objects.create(address_line="A", region="B", city="C", code_postal="1")
        specialty = Specialty.objects.create(name="Neurology", description="test")
        self.doc1_user = Users.objects.create_user(username="doc1", email="doc1@example.com", password="StrongPass!123", first_name="D", last_name="1", is_doctor=True, id_address=address)
        self.doc2_user = Users.objects.create_user(username="doc2", email="doc2@example.com", password="StrongPass!123", first_name="D", last_name="2", is_doctor=True, id_address=address)
        self.doc1 = Doctors.objects.create(user=self.doc1_user, specialty=specialty, bio="bio")
        self.doc2 = Doctors.objects.create(user=self.doc2_user, specialty=specialty, bio="bio")
        category = Category.objects.create(name="Health")
        self.blog = Blogs.objects.create(title="Private", description="x", summary="x", is_published=False, id_category=category, doctor=self.doc1)

    def test_doctor_cannot_edit_another_doctors_blog(self):
        self.client.force_login(self.doc2_user)
        response = self.client.get(reverse("upload_blog", args=[self.blog.blog_id]))
        self.assertEqual(response.status_code, 404)

    def test_other_doctor_cannot_view_draft(self):
        self.client.force_login(self.doc2_user)
        response = self.client.get(reverse("blog", args=[self.blog.blog_id]))
        self.assertEqual(response.status_code, 404)

    def test_doctor_dashboard_renders_without_demo_widgets(self):
        self.client.force_login(self.doc1_user)
        response = self.client.get(reverse("doctor_dashboard"))
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Bugungi qabul jadvali")
        self.assertNotContains(response, "Birthday Today")
