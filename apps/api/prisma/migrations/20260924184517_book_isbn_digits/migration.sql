-- AlterTable
ALTER TABLE "books" ADD COLUMN     "isbnDigits" TEXT;

-- CreateIndex
CREATE INDEX "books_isbnDigits_idx" ON "books"("isbnDigits");
