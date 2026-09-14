from django.urls import path

from doctors.views import blogs_category, doctor_blogs, post_comment, profile, search_blogs, view_blog
from .views import available_times, book_appointment, my_appointments, patient_confirm_book, patient_dashboard

urlpatterns = [
    path("patient_dashboard/", patient_dashboard, name="patient_dashboard"),
    path("profile/", profile, name="patient_profile"),
    path("blogs/", doctor_blogs, name="patient_blogs"),
    path("search/", search_blogs, name="search_blogs"),
    path("category/<str:cat>/", blogs_category, name="categories"),
    path("blog/<int:blog_id>/", view_blog, name="blog"),
    path("comment/", post_comment, name="comment"),
    path("book_appointment/", book_appointment, name="book_appointment"),
    path("my_appointments/", my_appointments, name="my_appointments"),
    path("available-times/<str:doctor>/", available_times, name="available_times"),
    path("patient_confirm_book/<str:doctor>/", patient_confirm_book, name="patient_confirm_book"),
]
