﻿using System;
using System.Collections.Generic;
using System.Data;
using Autofac;
using Hapil;
using Hapil.Operands;
using Hapil.Writers;
using NWheels.Concurrency;
using NWheels.Conventions.Core;
using NWheels.Core;
using NWheels.DataObjects;
using NWheels.DataObjects.Core;
using NWheels.Entities;
using NWheels.Entities.Core;
using TT = Hapil.TypeTemplate;

namespace NWheels.Testing.Entities.Impl
{
    public class TestDataRepositoryFactory : DataRepositoryFactoryBase
    {
        private readonly IComponentContext _components;
        private readonly EntityObjectFactory _entityFactory;

        //-----------------------------------------------------------------------------------------------------------------------------------------------------

        public TestDataRepositoryFactory(
            IComponentContext components, 
            DynamicModule module, 
            TypeMetadataCache metadataCache,
            IFrameworkDatabaseConfig dbConfiguration,
            IEnumerable<IDbConnectionStringResolver> databaseNameResolvers,
            TestEntityObjectFactory entityFactory)
            : base(module, metadataCache, new TestFramework.VoidStorageInitializer(), dbConfiguration, databaseNameResolvers)
        {
            _components = components;
            _entityFactory = entityFactory;
        }

        //-----------------------------------------------------------------------------------------------------------------------------------------------------

        public override IApplicationDataRepository NewUnitOfWork(
            IResourceConsumerScopeHandle consumerScope, 
            Type repositoryType, 
            bool autoCommit, 
            UnitOfWorkScopeOption? scopeOption = null, 
            string databaseName = null)
        {
            return (IApplicationDataRepository)CreateInstanceOf(repositoryType).UsingConstructor(
                consumerScope, 
                _components, 
                _entityFactory, 
                autoCommit);
        }

        //-----------------------------------------------------------------------------------------------------------------------------------------------------

        protected override IObjectFactoryConvention[] BuildConventionPipeline(ObjectFactoryContext context)
        {
            return new IObjectFactoryConvention[] {
                new TestDataRepositoryConvention(base.MetadataCache, _entityFactory, _components.Resolve<IDomainObjectFactory>())
            };
        }

        //-----------------------------------------------------------------------------------------------------------------------------------------------------

        public class TestDataRepositoryConvention : DataRepositoryConvention
        {
            public TestDataRepositoryConvention(TypeMetadataCache metadataCache, EntityObjectFactory entityFactory, IDomainObjectFactory domainObjectFactory)
                : base(metadataCache, entityFactory, domainObjectFactory)
            {
                base.RepositoryBaseType = typeof(TestDataRepositoryBase);
            }

            //-------------------------------------------------------------------------------------------------------------------------------------------------

            protected override IOperand<IEntityRepository<TypeTemplate.TContract>> GetNewEntityRepositoryExpression(
                EntityInRepository entity,
                MethodWriterBase writer,
                IOperand<TypeTemplate.TIndex1> partitionValue)
            {
                using ( TT.CreateScope<TT.TKey>(entity.Metadata.EntityIdProperty.ClrType) )
                {
                    return writer.New<TestEntityRepository<TT.TContract, TT.TKey>>(
                        writer.This<DataRepositoryBase>().Prop(x => x.Components),
                        base.EntityFactoryField,
                        base.DomainObjectFactoryField);
                }
            }
        }
    }
}
