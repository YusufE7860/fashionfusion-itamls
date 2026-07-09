-- CreateTable
CREATE TABLE "UserPermissionOverride" (
    "userId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,
    "effect" TEXT NOT NULL,

    CONSTRAINT "UserPermissionOverride_pkey" PRIMARY KEY ("userId","permissionId")
);

-- AddForeignKey
ALTER TABLE "UserPermissionOverride" ADD CONSTRAINT "UserPermissionOverride_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPermissionOverride" ADD CONSTRAINT "UserPermissionOverride_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
