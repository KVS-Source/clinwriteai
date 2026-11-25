-- Job title and department the invitee may enter on the accept-invitation page.
-- Both optional free text; existing users keep NULL.
ALTER TABLE "users" ADD COLUMN "title" TEXT;
ALTER TABLE "users" ADD COLUMN "department" TEXT;
