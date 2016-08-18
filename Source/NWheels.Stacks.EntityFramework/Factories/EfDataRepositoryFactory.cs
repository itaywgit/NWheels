﻿using System;
using System.Collections.Generic;
using System.Data;
using System.Data.Common;
using System.Data.Entity;
using System.Data.Entity.Infrastructure;
using System.Data.Entity.ModelConfiguration.Conventions;
using System.Linq;
using System.Reflection;
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
using NWheels.Extensions;
using NWheels.Stacks.EntityFramework.EFConventions;
using TT = Hapil.TypeTemplate;

// ReSharper disable ConvertToLambdaExpression

namespace NWheels.Stacks.EntityFramework.Factories
{
    public class EfDataRepositoryFactory : DataRepositoryFactoryBase
    {
        private readonly IComponentContext _components;
        private readonly DbProviderFactory _dbProvider;
        private readonly IFrameworkDatabaseConfig _dbConfiguration;
        private readonly ITypeMetadataCache _metadataCache;
        private readonly EntityObjectFactory _entityFactory;

        //-----------------------------------------------------------------------------------------------------------------------------------------------------

        public EfDataRepositoryFactory(
            IComponentContext components,
            DynamicModule module,
            EfEntityObjectFactory entityFactory,
            TypeMetadataCache metadataCache,
            IStorageInitializer storageInitializer,
            IEnumerable<IDbConnectionStringResolver> databaseNameResolvers,
            IFrameworkDatabaseConfig dbConfiguration,
            DbProviderFactory dbProvider = null)
            : base(module, metadataCache, storageInitializer, dbConfiguration, databaseNameResolvers)
        {
            _components = components;
            _entityFactory = entityFactory;
            _dbProvider = dbProvider;
            _dbConfiguration = dbConfiguration;
            _metadataCache = metadataCache;
        }

        //-----------------------------------------------------------------------------------------------------------------------------------------------------

        public override IApplicationDataRepository NewUnitOfWork(
            IResourceConsumerScopeHandle consumerScope, 
            Type repositoryType, 
            bool autoCommit, 
            UnitOfWorkScopeOption? scopeOption = null,
            string databaseName = null)
        {
            var connection = _dbProvider.CreateConnection();
            connection.ConnectionString = _dbConfiguration.ConnectionString;
            //TODO: replace database name if databaseName parameter is specified
            connection.Open();

            return (IApplicationDataRepository)CreateInstanceOf(repositoryType).UsingConstructor(consumerScope, _components, _entityFactory, _metadataCache, connection, autoCommit);
        }

        //-----------------------------------------------------------------------------------------------------------------------------------------------------

        protected override IObjectFactoryConvention[] BuildConventionPipeline(ObjectFactoryContext context)
        {
            return new IObjectFactoryConvention[] {
                new EfDataRepositoryConvention(_entityFactory, base.MetadataCache, _components.Resolve<IDomainObjectFactory>())
            };
        }

        //-----------------------------------------------------------------------------------------------------------------------------------------------------

        public class EfDataRepositoryConvention : ConnectedModelDataRepositoryConvention<DbConnection, DbCompiledModel>
        {
            public EfDataRepositoryConvention(EntityObjectFactory entityFactory, TypeMetadataCache metadataCache, IDomainObjectFactory domainObjectFactory)
                : base(entityFactory, metadataCache, domainObjectFactory)
            {
                this.RepositoryBaseType = typeof(EfDataRepositoryBase);
            }

            //-------------------------------------------------------------------------------------------------------------------------------------------------

            protected override void ImplementBuildDbCompiledModel(
                FunctionMethodWriter<DbCompiledModel> writer,
                Operand<ITypeMetadataCache> metadataCache,
                Operand<DbConnection> connection)
            {
                var m = writer;
                var modelBuilderLocal = m.Local<DbModelBuilder>(initialValue: m.New<DbModelBuilder>());
                
                //modelBuilderLocal.Prop(x => x.Conventions).Void(x => x.Add, m.NewArray<IConvention>(values:
                //    m.New<NoUnderscoreForeignKeyNamingConvention>()
                //));

                foreach ( var entity in base.EntitiesInRepository.OrderBy(EntityInheritanceDepth) )
                {
                    entity.EnsureImplementationType();

                    var entityConfigurationMethod = entity.ImplementationType.GetMethod("ConfigureEfModel", BindingFlags.Public | BindingFlags.Static);
                    Static.Void(entityConfigurationMethod, metadataCache, modelBuilderLocal);
                }

                foreach (var entity in base.EntitiesInRepository.OrderBy(EntityInheritanceDepth))
                {
                    entity.EnsureDomainObjectImplemented();
                }

                var modelLocal = m.Local(initialValue: modelBuilderLocal.Func<DbConnection, DbModel>(x => x.Build, connection));
                base.CompiledModelField.Assign(modelLocal.Func<DbCompiledModel>(x => x.Compile));
            }

            //-------------------------------------------------------------------------------------------------------------------------------------------------

            protected override IOperand<IEntityRepository<TT.TContract>> GetNewEntityRepositoryExpression(
                EntityInRepository entity,
                MethodWriterBase writer,
                IOperand<TT.TIndex1> partitionValue)
            {
                var thisMetaType = base.MetadataCache.GetTypeMetadata(TT.Resolve<TT.TContract>());
                var rootBaseMetaType = thisMetaType.GetRootBaseType();

                using ( TT.CreateScope<TT2.TEntityContract, TT2.TBaseEntity, TT2.TDerivedEntity>(
                    thisMetaType.ContractType, 
                    rootBaseMetaType.GetImplementationBy<EfEntityObjectFactory>(),
                    thisMetaType.GetImplementationBy<EfEntityObjectFactory>()) )
                {
                    return writer
                        .New<EfEntityRepository<TT2.TEntityContract, TT2.TBaseEntity, TT2.TDerivedEntity>>(writer.This<EfDataRepositoryBase>())
                        .CastTo<IEntityRepository<TT.TContract>>();
                }
            }

            //-------------------------------------------------------------------------------------------------------------------------------------------------

            private int EntityInheritanceDepth(EntityInRepository entity)
            {
                int depth = 0;

                for ( var metaType = entity.Metadata ;
                    metaType.BaseType != null ;
                    metaType = metaType.BaseType, depth++ )
                {
                }

                return depth;
            }
        }

        //-----------------------------------------------------------------------------------------------------------------------------------------------------

        // ReSharper disable InconsistentNaming
        public static class TT2
        {
            public interface TEntityContract : TypeTemplate.ITemplateType<TEntityContract>
            {
            }
            public interface TBaseEntity : TT2.TEntityContract, TypeTemplate.ITemplateType<TBaseEntity>
            {
            }
            public interface TDerivedEntity : TT2.TBaseEntity, TypeTemplate.ITemplateType<TDerivedEntity>
            {
            }
        }
    }
}
