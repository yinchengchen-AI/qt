-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_receiverUserId_fkey" FOREIGN KEY ("receiverUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_publishUserId_fkey" FOREIGN KEY ("publishUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
